var VSHADER_SOURCE_CHARACTERS = `
    attribute vec3 a_Position;
    attribute vec3 a_Normal;
    attribute vec2 a_TexCoord;

    uniform mat4 u_Model;
    uniform mat4 u_World;
    uniform mat4 u_Camera;
    uniform mat4 u_Projective;

    varying vec3 v_Normal;
    varying vec3 v_Position;
    varying vec2 v_Offset;
    varying vec2 v_TexCoord;
    void main() {
        gl_Position = u_Projective * u_Camera * u_World * u_Model * vec4(a_Position, 1.0);
        v_Normal = a_Normal;
        v_Position = a_Position;
        v_TexCoord = a_TexCoord;
    }
`

var FSHADER_SOURCE_CHARACTERS = `
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

    // textures
    uniform sampler2D u_Texture;
    varying vec2 v_TexCoord;

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

            vec3 texColor = texture2D(u_Texture, v_TexCoord).rgb;

            // finally, add our lights together
            // note that webGL will take the min(1.0, color) for us for each color component
            gl_FragColor = vec4((u_AmbientLight + diffuse) * texColor + specular * u_SpecColor, 1.0);
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

// ref to shader
var g_program_characters

// pointers

var g_model_ref
var g_camera_ref
var g_lighting_ref
var g_vertex_count
var g_projection_ref
var g_inverse_transpose_ref
var g_camera_inverse_transpose_ref
var g_light_ref
var g_ambient_light
var g_diffuse_color
var g_spec_power
var g_spec_color
var g_last_frame_ms
var g_framebuffer
var g_image_location

// grid
var g_grid_vertex_count

// global parameters
var g_camera_matrix
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
const INITIAL_FPS = 12
const INITIAL_AMBIENT_STRENGTH = 0.45
const INITIAL_SPEC_STRENGTH = 34.0
const INITIAL_LIGHT_X = 0.75
const INITIAL_LIGHT_Y = 0.86
const INITIAL_LIGHT_Z = -1.00
const INITIAL_CAMERA_X = 1.25
const INITIAL_CAMERA_Y = -2.35
const INITIAL_CAMERA_Z = -3.00
const INITIAL_NEAR = 1
const INITIAL_FAR = 200
const INITIAL_FOVY = 45
const INITIAL_ASPECT = 1.5

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

// dont want these changing
var g_ekko_model_matrix
var g_jinx_model_matrix

// each frame uses a different vbo that is loaded before anything is drawn
var VBO_Animation_Frames = []
var frameNumber = 0;
var animationLevel = 0;

// each element = [[ekko model][jinx model]]
var models = []

function main() {

    // Listen for slider changes
    slider_input = document.getElementById('sliderFPS')
    slider_input.addEventListener('input', (event) => {
        updateFPS(event.target.value)
    })
    slider_input = document.getElementById('sliderAmbientLightStrength')
    slider_input.addEventListener('input', (event) => {
        updateAmbientLightStrength(event.target.value)
    })
    slider_input = document.getElementById('sliderSpecLightStrength')
    slider_input.addEventListener('input', (event) => {
        updateSpecLightStrength(event.target.value)
    })
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
    /*if (!initShaders(gl, VSHADER_SOURCE_EKKO, FSHADER_SOURCE_EKKO)) {
        console.log('Failed to intialize shaders.')
        return;
    }*/

    g_program_characters = createProgram(gl, VSHADER_SOURCE_CHARACTERS, FSHADER_SOURCE_CHARACTERS)
    if (!g_program_characters) {
        console.log('Failed to create program')
        return
    }

    // new meshes for each frame
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_0)), new Model(parseOBJ(JINX_MESH_UNPARSED_0))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_1)), new Model(parseOBJ(JINX_MESH_UNPARSED_1))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_2)), new Model(parseOBJ(JINX_MESH_UNPARSED_2))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_3)), new Model(parseOBJ(JINX_MESH_UNPARSED_3))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_4)), new Model(parseOBJ(JINX_MESH_UNPARSED_4))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_5)), new Model(parseOBJ(JINX_MESH_UNPARSED_5))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_6)), new Model(parseOBJ(JINX_MESH_UNPARSED_6))])
    models.push([new Model(parseOBJ(EKKO_MESH_UNPARSED_7)), new Model(parseOBJ(JINX_MESH_UNPARSED_7))])

    gl.useProgram(g_program_characters)

    // setup all animation frames
    frameNumber = 0;
    setupAnimFrames(models)

    g_ekko_model_matrix = new Matrix4().scale(1.5, 1.5, 1.5).rotate(130, 0, 1, 0).translate(-0.3, 2.6, -2.3)
    g_ekko_world_matrix = new Matrix4().translate(-1, -0.3, 4.5)
   
    g_jinx_model_matrix = new Matrix4().scale(0.65, 0.65, 0.65).rotate(-35, 0, 1, 0)
    g_jinx_world_matrix = new Matrix4().translate(0.7, -2, -1)

    // Put the grid "below" the camera (and cubes)
    g_model_matrix_grid = new Matrix4()
    g_world_matrix_grid = new Matrix4().translate(0, -2, 0)

    g_model_ref = gl.getUniformLocation(g_program_characters, 'u_Model')
    g_world_ref = gl.getUniformLocation(g_program_characters, 'u_World')
    g_lighting_ref = gl.getUniformLocation(g_program_characters, 'u_Lighting')
    g_camera_ref = gl.getUniformLocation(g_program_characters, 'u_Camera')
    g_projection_ref = gl.getUniformLocation(g_program_characters, 'u_Projective')
    g_inverse_transpose_ref = gl.getUniformLocation(g_program_characters, 'u_InverseTranspose')
    g_light_ref = gl.getUniformLocation(g_program_characters, 'u_Light')
    g_ambient_light = gl.getUniformLocation(g_program_characters, 'u_AmbientLight')
    g_diffuse_color = gl.getUniformLocation(g_program_characters, 'u_DiffuseColor')
    g_spec_power = gl.getUniformLocation(g_program_characters, 'u_SpecPower')
    g_spec_color = gl.getUniformLocation(g_program_characters, 'u_SpecColor')
    g_image_location = gl.getUniformLocation(g_program_characters, 'u_Texture')

    // textures
    setupTextures();

    gl.uniform3fv(g_diffuse_color, new Float32Array([0.1, .5, .8]))
    gl.uniform3fv(g_spec_color, new Float32Array([1, 1, 1]))

    gl.enable(gl.CULL_FACE)
    gl.enable(gl.DEPTH_TEST)

    // Setup for ticks
    g_last_frame_ms = Date.now()
    g_rotation_axis = [0, 1, 0]

    // Initialize our data
    updateFPS(INITIAL_FPS)
    updateAmbientLightStrength(INITIAL_AMBIENT_STRENGTH)
    updateSpecLightStrength(INITIAL_SPEC_STRENGTH)
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

    // inital camera setup
    g_camera_matrix = new Matrix4().setLookAt(-g_camera_x, g_camera_y, g_camera_z, -1, -1, 4, 0, 1, 0)
    g_camera_matrix.rotate(-5, 0, 1, 0).translate(0, -1.3, 5)

    tick()
}

function setupAnimFrames(models) {
    grid_data = build_grid_attributes(1, 1)
    grid_mesh = grid_data[0]
    grid_normals = grid_data[1] // fake normals

    for (let i = 0; i < models.length; i++) {
        ekko = models[i][0]
        jinx = models[i][1]

        // get the VBO handle
        var VBOloc = gl.createBuffer();
        if (!VBOloc) {
        console.log('Failed to create the vertex buffer object')
        return -1
        }

        // put the normal attributes after our mesh
        var attributes = ekko.mesh.concat(jinx.mesh).concat(grid_mesh)              // vertices
                    .concat(ekko.normals).concat(jinx.normals).concat(grid_normals) // normals
                    .concat(ekko.texture_coords).concat(jinx.texture_coords)        // tex coords

        gl.bindBuffer(gl.ARRAY_BUFFER, VBOloc)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(attributes), gl.STATIC_DRAW) // TODO: figure out how to change attributes

        VBO_Animation_Frames.push(VBOloc)
    }
}

function setupTextures() {
    // ekko
    var ekko_texture = gl.createTexture();

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, ekko_texture);

    // default fill just in case
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 255, 255]));

    var ekko_texture_image = new Image();
    ekko_texture_image.src = "textures/ekko_base_tx_cm_x_flipped.png";
    ekko_texture_image.addEventListener('load', function() {
        gl.bindTexture(gl.TEXTURE_2D, ekko_texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ekko_texture_image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    });

    // jinx
    var jinx_texture = gl.createTexture();

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, jinx_texture);

    // default fill just in case
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 255, 255]));

    var jinx_texture_image = new Image();
    jinx_texture_image.src = "textures/jinx_base_tx_cm_x_flipped.png";
    jinx_texture_image.addEventListener('load', function() {
        gl.bindTexture(gl.TEXTURE_2D, jinx_texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, jinx_texture_image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        
        // DEFAULT BLUE - has to load within this function so that jinx's texture doesn't override it.
        var basic_texture = gl.createTexture();

        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, basic_texture);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 255, 255]));
    });


}

// extra constants for cleanliness
var ROTATION_SPEED = .02
var reverse = false;
var delta_time_characters = 0
var delta_time_g = 0
var current_time = Date.now()
var fps = 1000 / 10

function characterAnimationTick() {
    if (delta_time_characters > fps) {
        g_last_frame_ms = current_time - (delta_time_characters % fps);
        
        // reversing animation
        if (reverse) {
            frameNumber -= 1;
        }
        else {
            frameNumber += 1;
        }

        // reset delta_time
        delta_time_characters = 0
    }
}

// function to apply all the logic for a single frame tick
function tick() {
    // time since the last frame
    // caution: on the first frame, this may be zero
    // and in general, this may be close to zero
    // NOTE: Be sure to use this delta_time!
    //   otherwise your animation will be framerate-dependent!
    // calculate time since the last frame
    current_time = Date.now()
    delta_time_characters += current_time - g_last_frame_ms
    delta_time_g += current_time - g_last_frame_ms
    g_last_frame_ms = current_time
    
    if (delta_time_g > 1500) {
        animationLevel = 1
    }
    if (delta_time_g > 3000) {
        animationLevel = 2
    }

    // camera rotation animation
    var angleSwitch = 1;
    if (Math.floor(delta_time_g / 4000) % 2 == 0) {
        angleSwitch *= -1
    }

    angle = angleSwitch * ROTATION_SPEED * 4
    
    g_camera_matrix.rotate(angle, 0, 1, 0)

    // character animation 
    switch(animationLevel) {
        case 0:
            break;
        case 1:
            break;
        case 2:
            characterAnimationTick();
            break;
    }

    //jinx.world_matrix.rotate(angle, 0, 1, 0)
    
    // ref frame
    g_ekko_world_matrix = new Matrix4()   
    g_ekko_world_matrix.concat(g_jinx_world_matrix).concat(g_world_matrix_grid)

    /*// lighting rotate
    g_light_x = jinx.world_matrix.elements[12] + 0.2
    g_light_y = jinx.world_matrix.elements[13] + 0.3
    g_light_z = jinx.world_matrix.elements[14]*/

    draw()

    requestAnimationFrame(tick, g_canvas)
}

function drawJinxEkkoAnimation() {
    const FLOAT_SIZE = 4

    if (setup_vec(3, g_program_characters, 'a_Position', 0) < 0) {
        return -1
    }
    if (setup_vec(3, g_program_characters, 'a_Normal', (ekko.vertex_count + jinx.vertex_count + g_grid_vertex_count * 3) * FLOAT_SIZE) < 0) {
        return -1
    }
    if (setup_vec(2, g_program_characters, 'a_TexCoord', (ekko.vertex_count + jinx.vertex_count + g_grid_vertex_count * 3 + 
                                                        ekko.normals.length + jinx.normals.length + g_grid_vertex_count * 3) * FLOAT_SIZE) < 0) {
        return -1
    }
    
    // use lighting for ekko and jinx
    gl.uniform1i(g_lighting_ref, 1)


    // default ambient lighting for ekko and jinx
    //gl.uniform3fv(g_ambient_light, new Float32Array([0.2, 0.2, 0.2]))
    
    // Update with our global model and world matrices
    gl.uniformMatrix4fv(g_model_ref, false, g_ekko_model_matrix.elements)
    gl.uniformMatrix4fv(g_world_ref, false, g_ekko_world_matrix.elements)
    var inv = new Matrix4(g_ekko_world_matrix)
        .concat(g_ekko_model_matrix)
        .invert().transpose()
    gl.uniformMatrix4fv(g_inverse_transpose_ref, false, inv.elements)
    
    // ekko texture
    switch (animationLevel) {
        case 0:
            gl.uniform1i(g_image_location, 2)
            break;
        case 1:
            gl.uniform1i(g_image_location, 0)
            break;
        case 2:
            gl.uniform1i(g_image_location, 0)
            break;
    }

    // draw ekko
    gl.drawArrays(gl.TRIANGLES, 0, ekko.vertex_count / 3)

    gl.uniformMatrix4fv(g_model_ref, false, g_jinx_model_matrix.elements)
    gl.uniformMatrix4fv(g_world_ref, false, g_jinx_world_matrix.elements)
    var inv = new Matrix4(g_jinx_world_matrix)
        .concat(g_jinx_model_matrix)
        .invert().transpose()
    gl.uniformMatrix4fv(g_inverse_transpose_ref, false, inv.elements)

    // jinx texture
    switch (animationLevel) {
        case 0:
            gl.uniform1i(g_image_location, 2)
            break;
        case 1:
            gl.uniform1i(g_image_location, 1)
            break;
        case 2:
            gl.uniform1i(g_image_location, 1)
            break;
    }

    // draw jinx
    gl.drawArrays(gl.TRIANGLES, ekko.vertex_count / 3, jinx.vertex_count / 3)
}

// draw to the screen on the next frame
function draw() {
    // Clear the canvas with a black background
    gl.clearColor(0.0, 0.0, 0.0, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.useProgram(g_program_characters)

    // setup our camera
    /*g_camera_matrix.setLookAt(-g_camera_x, g_camera_y, g_camera_z, 0, 0, 4, 0, 1, 0)
    g_camera_matrix.translate(0, -0.5, 5)*/
    gl.uniformMatrix4fv(g_camera_ref, false, g_camera_matrix.elements)
    var perspective_matrix = new Matrix4().setPerspective(g_fovy, g_aspect, g_near, g_far)
    gl.uniformMatrix4fv(g_projection_ref, false, perspective_matrix.elements)

    // setup our light source
    // note the negative X-direction to make us right-handed
    gl.uniform3fv(g_light_ref, new Float32Array([-g_light_x, g_light_y, g_light_z]))

    // decide what frame to draw
    if (frameNumber > models.length - 1) {
        reverse = true;
        frameNumber -= 1
    }
    else if (frameNumber < 0) {
        reverse = false;
        frameNumber += 1
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, VBO_Animation_Frames[frameNumber])
    ekko = models[frameNumber][0]
    jinx = models[frameNumber][1]

    drawJinxEkkoAnimation()

    // Draw the grid with gl.lines // TODO: fix grid, maybe add floor instead with new shader
    // Note that we can use the regular vertex offset with gl.LINES
    gl.uniform1i(g_lighting_ref, 0) // don't use lighting for the grid
    //gl.uniform3fv(g_ambient_light, new Float32Array([1, 1, 1])) // grid is green
    gl.uniformMatrix4fv(g_model_ref, false, g_model_matrix_grid.elements)
    gl.uniformMatrix4fv(g_world_ref, false, g_world_matrix_grid.elements)
    gl.drawArrays(gl.LINES, ekko.vertex_count / 3 + jinx.vertex_count / 3, g_grid_vertex_count)
}

// Helper to setup vec3 attributes
function setup_vec(size, program, name, offset) {
    // Get the attribute
    var attributeID = gl.getAttribLocation(program, `${name}`)
    if (attributeID < 0) {
        console.log(`Failed to get the storage location of ${name}`)
        return -1
    }

    // Set how the GPU fills the a_Position variable with data from the GPU 
    gl.vertexAttribPointer(attributeID, size, gl.FLOAT, false, 0, offset)
    gl.enableVertexAttribArray(attributeID)

    return 0
}

function updateFPS(amount) {
    label = document.getElementById('fps')
    label.textContent = `FPS: ${Number(amount).toFixed(2)}`
    fps = 1000 / amount
    console.log(fps)
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
function updateAmbientLightStrength(amount) {
    label = document.getElementById('ambientLightStrength')
    label.textContent = `Ambient Light Strength: ${Number(amount).toFixed(2)}`
    gl.uniform3fv(g_ambient_light, new Float32Array([amount, amount, amount]))
}
function updateSpecLightStrength(amount) {
    label = document.getElementById('specLightStrength')
    label.textContent = `Specular Light Strength: ${Number(amount).toFixed(2)}`
    gl.uniform1f(g_spec_power, amount)
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
        finalVertices[2].push(vertex_textures[(texture_face*2)-2])
        finalVertices[2].push(vertex_textures[(texture_face*2)-1])
    }
    return finalVertices
  }