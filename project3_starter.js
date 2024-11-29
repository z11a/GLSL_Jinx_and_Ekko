// Last edited by Dietrich Geisler 2024

var VSHADER_SOURCE = `
    attribute vec3 a_Position;
    attribute vec3 a_Normal;

    uniform mat4 u_Model;
    uniform mat4 u_World;
    uniform mat4 u_Camera;
    uniform mat4 u_Projective;

    varying vec3 v_Normal;
    varying vec3 v_Position;
    void main() {
        gl_Position = u_Projective * u_Camera * u_World * u_Model * vec4(a_Position, 1.0);
        v_Normal = a_Normal;
        v_Position = a_Position;
    }
`

var FSHADER_SOURCE = `
    precision mediump float;
    
    // Setup our varyings
    varying vec3 v_Normal;
    varying vec3 v_Position;

    // determine whether or not to use lighting
    uniform int u_Lighting;

    // Note that our uniforms need not be declared in the vertex shader
    uniform highp mat4 u_Model;
    uniform highp mat4 u_World;
    uniform highp mat4 u_Camera;
    uniform highp mat4 u_CameraInverse;
    uniform highp mat4 u_InverseTranspose; // for normal transformation, model and world
    uniform vec3 u_Light; // where the light is located
    uniform vec3 u_AmbientLight; // the lighting from the world
    uniform vec3 u_DiffuseColor; // the base color of the model
    uniform float u_SpecPower; // the specular "power" of the light on this model
    uniform vec3 u_SpecColor; // the specular color on this model

    // Reminder, since this comes up a lot in this math
    // for points A and B, B-A produces the vector pointing from A to B

    // helper function for homogeneous transformation
    mediump vec3 hom_reduce(mediump vec4 v) {
        // component-wise division of v
        return vec3(v) / v.w;
    }

    void main() {
        if (u_Lighting > 0) {
            // usual normal transformation
            vec3 worldNormal = normalize(mat3(u_InverseTranspose) * normalize(v_Normal));
            // usual position transformation
            vec3 worldPos = hom_reduce(u_World * u_Model * vec4(v_Position, 1.0));

            // also transform the position into the camera space to calculate the specular
            vec3 cameraPos = hom_reduce(u_Camera * vec4(worldPos, 1.0));

            // calculate our light direction
            vec3 lightDir = normalize(u_Light - worldPos); // get the direction towards the light

            // first, calculate our diffuse light
            float diffuse = dot(lightDir, worldNormal);

            // second, calculate our specular highlight
            // see https://learnopengl.com/Lighting/Basic-Lighting for more details
            vec3 reflectDir = normalize(reflect(-lightDir, worldNormal)); // reflect the light past our normal

            // We need our reflection to be in Camera space
            // note that this is a direction rather than a normal
            // so we don't need an inverse transpose of the world->camera matrix
            // but we _do_ need to apply a linear operation, so we use mat3
            vec3 cameraReflectDir = normalize(mat3(u_Camera) * reflectDir);

            // Now, get the direction to the camera, noting that the camera is at 0, 0, 0 in camera space
            vec3 cameraDir = normalize(-cameraPos);

            // calculate the angle between the cameraDir and
            //   the reflected light direction _toward_ the camera(in camera space)
            float angle = max(dot(cameraDir, cameraReflectDir), 0.0);
            // calculate fall-off with power
            float specular = pow(angle, u_SpecPower);

            // finally, add our lights together
            // note that webGL will take the min(1.0, color) for us for each color component
            gl_FragColor = vec4(u_AmbientLight + diffuse * u_DiffuseColor + specular * u_SpecColor, 1.0);
        }
        else {
            gl_FragColor = vec4(u_AmbientLight, 1.0);
        }
    }
`

// the rotation matrix being updated each frame
var g_teapot_model_matrix

// the current axis of rotation (for all teapots)
var g_rotation_axis

// references to general information
var g_canvas
var gl

// pointers
var g_lighting_ref
var g_vertex_count
var g_model_ref
var g_camera_ref
var g_projection_ref
var g_inverse_transpose_ref
var g_camera_inverse_transpose_ref
var g_light_ref
var g_ambient_light
var g_diffuse_color
var g_spec_power
var g_spec_color
var g_last_frame_ms

// grid
var g_grid_vertex_count

// global parameters
var g_light_x
var g_light_y
var g_light_z
var g_camera_x
var g_camera_y
var g_camera_z
var g_near
var g_far
var g_fovy
var g_aspect

// constants for setup
const INITIAL_LIGHT_X = 0
const INITIAL_LIGHT_Y = 0
const INITIAL_LIGHT_Z = -2
const INITIAL_CAMERA_X = 0
const INITIAL_CAMERA_Y = 1.2
const INITIAL_CAMERA_Z = -3.00
const INITIAL_NEAR = 1
const INITIAL_FAR = 200
const INITIAL_FOVY = 45
const INITIAL_ASPECT = 1

// Matrices for positioning the grid
var g_model_matrix_grid
var g_world_matrix_grid

// the number of floats in each mesh vertex element (e.g. vec3)
var MESH_VERTEX_SIZE = 3

// new meshes
class Model {
    constructor(parsed_mesh) {
        this.mesh = parsed_mesh[0];
        this.normals = parsed_mesh[1];
        this.texture_coords = parsed_mesh[2];
        this.vertex_count = parsed_mesh[0].length;
        this.model_matrix = new Matrix4();
        this.world_matrix = new Matrix4();
    }
}

var ekko
var jinx

function main() {

    // Listen for slider changes
    slider_input = document.getElementById('sliderLightX')
    slider_input.addEventListener('input', (event) => {
        updateLightX(event.target.value)
    })
    slider_input = document.getElementById('sliderLightY')
    slider_input.addEventListener('input', (event) => {
        updateLightY(event.target.value)
    })
    slider_input = document.getElementById('sliderLightZ')
    slider_input.addEventListener('input', (event) => {
        updateLightZ(event.target.value)
    })

    slider_input = document.getElementById('sliderCamX')
    slider_input.addEventListener('input', (event) => {
        updateCameraX(event.target.value)
    })
    slider_input = document.getElementById('sliderCamY')
    slider_input.addEventListener('input', (event) => {
        updateCameraY(event.target.value)
    })
    slider_input = document.getElementById('sliderCamZ')
    slider_input.addEventListener('input', (event) => {
        updateCameraZ(event.target.value)
    })

    slider_input = document.getElementById('sliderNear')
    slider_input.addEventListener('input', (event) => {
        updateNear(event.target.value)
    })

    slider_input = document.getElementById('sliderFar')
    slider_input.addEventListener('input', (event) => {
        updateFar(event.target.value)
    })

    slider_input = document.getElementById('sliderFOVY')
    slider_input.addEventListener('input', (event) => {
        updateFOVY(event.target.value)
    })

    slider_input = document.getElementById('sliderAspect')
    slider_input.addEventListener('input', (event) => {
        updateAspect(event.target.value)
    })

    g_canvas = document.getElementById('webgl');

    // Get the rendering context for WebGL
    gl = getWebGLContext(g_canvas, true);
    if (!gl) {
        console.log('Failed to get the rendering context for WebGL');
        return;
    }

    // Initialize GPU's vertex and fragment shaders programs
    if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
        console.log('Failed to intialize shaders.')
        return;
    }

    // new meshes
    ekko = new Model(parseOBJ(EKKO_MESH_UNPARSED))
    jinx = new Model(parseOBJ(JINX_MESH_UNPARSED))

    // get the VBO handle
    var VBOloc = gl.createBuffer();
    if (!VBOloc) {
        console.log('Failed to create the vertex buffer object')
        return -1
    }

    grid_data = build_grid_attributes(1, 1)
    grid_mesh = grid_data[0]
    grid_normals = grid_data[1] // fake normals

    // put the normal attributes after our mesh
    var attributes = ekko.mesh.concat(jinx.mesh).concat(grid_mesh).concat(ekko.normals).concat(jinx.normals).concat(grid_normals)
    gl.bindBuffer(gl.ARRAY_BUFFER, VBOloc)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attributes), gl.STATIC_DRAW)

    const FLOAT_SIZE = 4

    // put the attributes on the VBO
    if (setup_vec3('a_Position', 0) < 0) {
        return -1
    }
    if (setup_vec3('a_Normal', (ekko.vertex_count + jinx.vertex_count + g_grid_vertex_count * 3) * FLOAT_SIZE) < 0) {
        return -1
    }

    // reference to our pointers
    g_lighting_ref = gl.getUniformLocation(gl.program, 'u_Lighting')
    g_model_ref = gl.getUniformLocation(gl.program, 'u_Model')
    g_world_ref = gl.getUniformLocation(gl.program, 'u_World')
    g_camera_ref = gl.getUniformLocation(gl.program, 'u_Camera')
    g_projection_ref = gl.getUniformLocation(gl.program, 'u_Projective')
    g_inverse_transpose_ref = gl.getUniformLocation(gl.program, 'u_InverseTranspose')
    g_light_ref = gl.getUniformLocation(gl.program, 'u_Light')
    g_ambient_light = gl.getUniformLocation(gl.program, 'u_AmbientLight')
    g_diffuse_color = gl.getUniformLocation(gl.program, 'u_DiffuseColor')
    g_spec_power = gl.getUniformLocation(gl.program, 'u_SpecPower')
    g_spec_color = gl.getUniformLocation(gl.program, 'u_SpecColor')

    // setup our teapot with heavy scaling
    // Note the negative z-scaling to get into right-handed coordinates
    ekko.model_matrix = new Matrix4().scale(1.5, 1.5, 1.5).rotate(140, 0, 1, 0).translate(-0.5, 2.3, -2)
    ekko.world_matrix = new Matrix4().translate(-1, -0.3, 4.5)
   
    jinx.model_matrix = new Matrix4().scale(0.65, 0.65, 0.65).rotate(-25, 0, 1, 0)
    jinx.world_matrix = new Matrix4().translate(0.4,-2,2.0)

    // Put the grid "below" the camera (and cubes)
    g_model_matrix_grid = new Matrix4()
    g_world_matrix_grid = new Matrix4().translate(0, -2, 0)

    gl.enable(gl.CULL_FACE)
    // Enable a depth test with perspective
    gl.enable(gl.DEPTH_TEST)

    // Setup for ticks
    g_last_frame_ms = Date.now()
    g_rotation_axis = [0, 1, 0]

    // Initialize our data
    updateLightX(INITIAL_LIGHT_X)
    updateLightY(INITIAL_LIGHT_Y)
    updateLightZ(INITIAL_LIGHT_Z)
    updateCameraX(INITIAL_CAMERA_X)
    updateCameraY(INITIAL_CAMERA_Y)
    updateCameraZ(INITIAL_CAMERA_Z)
    updateNear(INITIAL_NEAR)
    updateFar(INITIAL_FAR)
    updateFOVY(INITIAL_FOVY)
    updateAspect(INITIAL_ASPECT)

    tick()
}

// extra constants for cleanliness
var ROTATION_SPEED = .02

// function to apply all the logic for a single frame tick
function tick() {
    // time since the last frame
    // caution: on the first frame, this may be zero
    // and in general, this may be close to zero
    // NOTE: Be sure to use this delta_time!
    //   otherwise your animation will be framerate-dependent!
    var delta_time

    // calculate time since the last frame
    var current_time = Date.now()
    delta_time = current_time - g_last_frame_ms
    g_last_frame_ms = current_time

    // rotate the arm constantly around the given axis (of the model)
    angle = ROTATION_SPEED * delta_time

    // ref frame
    jinx.world_matrix.rotate(angle, 0, 1, 0)


    ekko.world_matrix = new Matrix4()   
    ekko.world_matrix.concat(jinx.world_matrix).concat(g_world_matrix_grid)

    draw()

    requestAnimationFrame(tick, g_canvas)
}

// draw to the screen on the next frame
function draw() {
    // setup our camera
    // always look at the teapot (a constant number because I'm lazy)
    var camera_matrix = new Matrix4().setLookAt(-g_camera_x, g_camera_y, g_camera_z, 0, 0, 4, 0, 1, 0)
    camera_matrix.translate(0, -0.5, 5)
    gl.uniformMatrix4fv(g_camera_ref, false, camera_matrix.elements)
    var perspective_matrix = new Matrix4().setPerspective(g_fovy, g_aspect, g_near, g_far)
    gl.uniformMatrix4fv(g_projection_ref, false, perspective_matrix.elements)

    // setup our light source
    // note the negative X-direction to make us right-handed
    gl.uniform3fv(g_light_ref, new Float32Array([-g_light_x, g_light_y, g_light_z]))

    // Update with our global model and world matrices
    gl.uniformMatrix4fv(g_model_ref, false, ekko.model_matrix.elements)
    gl.uniformMatrix4fv(g_world_ref, false, ekko.world_matrix.elements)
    var inv = new Matrix4(ekko.world_matrix)
        .concat(ekko.model_matrix)
        .invert().transpose()
    gl.uniformMatrix4fv(g_inverse_transpose_ref, false, inv.elements)

    // Clear the canvas with a black background
    gl.clearColor(0.0, 0.0, 0.0, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // use lighting for the teapot
    gl.uniform1i(g_lighting_ref, 1)

    // set a position and colors for the teapot, and draw
    gl.uniform3fv(g_ambient_light, new Float32Array([0, 0, 0]))
    gl.uniform3fv(g_diffuse_color, new Float32Array([0.1, .5, .8]))
    gl.uniform1f(g_spec_power, 64.0)
    gl.uniform3fv(g_spec_color, new Float32Array([1, 1, 1]))

    gl.drawArrays(gl.TRIANGLES, 0, ekko.vertex_count / 3)

    // jinx
    gl.uniformMatrix4fv(g_model_ref, false, jinx.model_matrix.elements)
    gl.uniformMatrix4fv(g_world_ref, false, jinx.world_matrix.elements)
    var inv = new Matrix4(jinx.world_matrix)
        .concat(jinx.model_matrix)
        .invert().transpose()
    gl.uniformMatrix4fv(g_inverse_transpose_ref, false, inv.elements)
    gl.uniform3fv(g_ambient_light, new Float32Array([0, 0, 0]))
    gl.uniform3fv(g_diffuse_color, new Float32Array([0.1, .5, .8]))
    gl.uniform1f(g_spec_power, 64.0)
    gl.uniform3fv(g_spec_color, new Float32Array([1, 1, 1]))

    gl.drawArrays(gl.TRIANGLES, ekko.vertex_count / 3, jinx.vertex_count / 3)


    // Draw the grid with gl.lines
    // Note that we can use the regular vertex offset with gl.LINES
    gl.uniform1i(g_lighting_ref, 0) // don't use lighting for the grid
    gl.uniform3fv(g_ambient_light, new Float32Array([0, 1, 0])) // grid is green
    gl.uniformMatrix4fv(g_model_ref, false, g_model_matrix_grid.elements)
    gl.uniformMatrix4fv(g_world_ref, false, g_world_matrix_grid.elements)
    gl.drawArrays(gl.LINES, ekko.vertex_count / 3 + jinx.vertex_count / 3, g_grid_vertex_count)
}

// Helper to setup vec3 attributes
function setup_vec3(name, offset) {
    // Get the attribute
    var attributeID = gl.getAttribLocation(gl.program, `${name}`)
    if (attributeID < 0) {
        console.log(`Failed to get the storage location of ${name}`)
        return -1;
    }

    // Set how the GPU fills the a_Position variable with data from the GPU 
    gl.vertexAttribPointer(attributeID, 3, gl.FLOAT, false, 0, offset)
    gl.enableVertexAttribArray(attributeID)

    return 0
}

// Event to change which rotation is selected
function updateRotation() {
    var rotateX = document.getElementById('rotateX')
    var rotateY = document.getElementById('rotateY')
    var rotateZ = document.getElementById('rotateZ')

    g_rotation_axis[0] = Number(rotateX.checked)
    g_rotation_axis[1] = Number(rotateY.checked)
    g_rotation_axis[2] = Number(rotateZ.checked)
}

function updateLightX(amount) {
    label = document.getElementById('lightX')
    label.textContent = `Light X: ${Number(amount).toFixed(2)}`
    g_light_x = Number(amount)
}

function updateLightY(amount) {
    label = document.getElementById('lightY')
    label.textContent = `Light Y: ${Number(amount).toFixed(2)}`
    g_light_y = Number(amount)
}

function updateLightZ(amount) {
    label = document.getElementById('lightZ')
    label.textContent = `Light Z: ${Number(amount).toFixed(2)}`
    g_light_z = Number(amount)
}

function updateCameraX(amount) {
    label = document.getElementById('cameraX')
    label.textContent = `Camera X: ${Number(amount).toFixed(2)}`
    g_camera_x = Number(amount)
}

function updateCameraY(amount) {
    label = document.getElementById('cameraY')
    label.textContent = `Camera Y: ${Number(amount).toFixed(2)}`
    g_camera_y = Number(amount)
}

function updateCameraZ(amount) {
    label = document.getElementById('cameraZ')
    label.textContent = `Camera Z: ${Number(amount).toFixed(2)}`
    g_camera_z = Number(amount)
}

function updateNear(amount) {
    label = document.getElementById('near')
    label.textContent = `Near: ${Number(amount).toFixed(2)}`
    g_near = Number(amount)
}

function updateFar(amount) {
    label = document.getElementById('far')
    label.textContent = `Far: ${Number(amount).toFixed(2)}`
    g_far = Number(amount)
}

function updateFOVY(amount) {
    label = document.getElementById('fovy')
    label.textContent = `FOVY: ${Number(amount).toFixed(2)}`
    g_fovy = Number(amount)
}

function updateAspect(amount) {
    label = document.getElementById('aspect')
    label.textContent = `Aspect: ${Number(amount).toFixed(2)}`
    g_aspect = Number(amount)
}

// How far in the X and Z directions the grid should extend
// Recall that the camera "rests" on the X/Z plane, since Z is "out" from the camera
const GRID_X_RANGE = 100
const GRID_Z_RANGE = 100

// Helper to build a grid mesh and colors
// Returns these results as a pair of arrays
// Each vertex in the mesh is constructed with an associated grid_color
function build_grid_attributes(grid_row_spacing, grid_column_spacing) {
    if (grid_row_spacing < 1 || grid_column_spacing < 1) {
        console.error("Cannot have grid spacing less than 1")
        return [[], []]
    }
    var mesh = []

    // Construct the rows
    for (var x = -GRID_X_RANGE; x < GRID_X_RANGE; x += grid_row_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(x, 0, -GRID_Z_RANGE)
        mesh.push(x, 0, GRID_Z_RANGE)
    }

    // Construct the columns extending "outward" from the camera
    for (var z = -GRID_Z_RANGE; z < GRID_Z_RANGE; z += grid_row_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(-GRID_X_RANGE, 0, z)
        mesh.push(GRID_X_RANGE, 0, z)
    }

    g_grid_vertex_count = mesh.length / 3

    var mesh_normals = []
    // Add in dummy normals for padding
    for (var i = 0; i < mesh.length / 3; i++) {
        mesh_normals.push(0, 1, 0)
    }

    return [mesh, mesh_normals]
}

function parseOBJ(data) {
    const vertices = [];
    const vertex_normals = [];
    const vertex_textures = [];

    const vertex_faces = [];
    const normal_faces = [];
    const texture_faces = [];
  
    const lines = data.split('\n');
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('v ')) {
            const parts = line.split(" ");
            vertices.push(
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            );
        } else if (line.startsWith('vn ')) {
            const parts = line.split(" ");
            vertex_normals.push(
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            );
        } else if (line.startsWith('vt ')) {
            const parts = line.split(" ");
            vertex_textures.push(
                parseFloat(parts[1]),
                parseFloat(parts[2]),
            );
        } else if (line.startsWith('f ')) {

            // line example = "f 1/1/1 2/2/2 3/3/3"
            const parts = line.split(" ");          // parts = ["f", "1/1/1", "2/2/2", "3/3/3"]

            smaller_parts = []

            for (part of parts) {
                smaller_parts.push(part.split("/")) // smaller_parts = [["f"], ["1", "1", "1"], ["2", "2", "2"], ["3", "3", "3"]]
            }
            
            // vertices
            vertex_faces.push(
                parseFloat(smaller_parts[1][0]),
                parseFloat(smaller_parts[2][0]),
                parseFloat(smaller_parts[3][0])
            )

            // textures
            texture_faces.push(
                parseFloat(smaller_parts[1][1]),
                parseFloat(smaller_parts[2][1]),
                parseFloat(smaller_parts[3][1])
            )

             // normals
             normal_faces.push(
                parseFloat(smaller_parts[1][2]),
                parseFloat(smaller_parts[2][2]),
                parseFloat(smaller_parts[3][2])
            )
        } 
      }
    // faces
    var finalVertices = [[], [], []];
    for (vertex_face of vertex_faces) {
        finalVertices[0].push(vertices[(vertex_face*3)-3])
        finalVertices[0].push(vertices[(vertex_face*3)-2])
        finalVertices[0].push(vertices[(vertex_face*3)-1])
    }

    for (normal_face of normal_faces) {
        finalVertices[1].push(vertex_normals[(normal_face*3)-3])
        finalVertices[1].push(vertex_normals[(normal_face*3)-2])
        finalVertices[1].push(vertex_normals[(normal_face*3)-1])
    }

    for (texture_face of texture_faces) {
        finalVertices[2].push(vertex_textures[(texture_face*3)-3])
        finalVertices[2].push(vertex_textures[(texture_face*3)-2])
        finalVertices[2].push(vertex_textures[(texture_face*3)-1])
    }
    return finalVertices
  }