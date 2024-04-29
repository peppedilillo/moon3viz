import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader'
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js'

import GUI from 'lil-gui'


/**
 * Base
 */

// Debug
const gui = new GUI()


/**
 * Constants
 */
const d_unit = 1 / 173400 //km
const t_unit_gui = {
    t_unit: 1,
}
gui.add(t_unit_gui, "t_unit").min(0.1).max(10).step(.1)

const MOON_REVOLUTION_PERIOD = 28 * 24 * 60
const EARTH_REVOLUTION_PERIOD = 365 * 24 * 60
const EARTH_ROTATION_PERIOD = 1 * 24 * 60
const MOON_RADIUS = 1734 * d_unit
const EARTH_RADIUS = 6371 * d_unit
const SUN_RADIUS = 696340 * d_unit
const EARTH_MOON_DISTANCE = 384400 * d_unit
const SUN_EARTH_DISTANCE = 150 * 10 ** 6 * d_unit
// serves also for background star map inclination, 
// since the map is in cel. coordinates
const EARTH_AXIS_TILT = 23.5 / 360 * 2 * Math.PI
const SUN_LUMINOSITY = 3 * 10 ** 6

const FAR = SUN_EARTH_DISTANCE * 2
const EARTH_POSITION = new THREE.Vector3(0, 0, SUN_EARTH_DISTANCE)

/**
 * Utils
 */
const radians = (degrees) => {
	return degrees * Math.PI / 180;
}

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()
scene.environmentRotation.y = 1


/**
 * Textures
 */
const loadingManager = new THREE.LoadingManager()
loadingManager.onError = (texture) => {
    console.log("error loading texture " + texture)
}
const textureLoader = new THREE.TextureLoader(loadingManager)
const moonColorTexture = textureLoader.load('textures/moon/moon_color_8k.jpg')
moonColorTexture.colorSpace = THREE.SRGBColorSpace
const moonHeightTexture = textureLoader.load('textures/moon/moon_height_16ppd.jpg')
const earthColorTexture = textureLoader.load('textures/earth/earth_2k.jpg')

const textureFlare0 = textureLoader.load("textures/lensflare/lensflare0_alpha.png")
const textureFlare1 = textureLoader.load("textures/lensflare/lensflare2.png")
const textureFlare2 = textureLoader.load("textures/lensflare/lensflare3.png")
const textureFlareHex = textureLoader.load("textures/lensflare/hexangle.png")


/**
 * Environment
 */
const rgbeLoader = new RGBELoader()
rgbeLoader.load('textures/nightsky/starmap_2020_4k.hdr', (envMap) => {
    envMap.mapping = THREE.EquirectangularReflectionMapping
    scene.background = envMap
    scene.environment = envMap
})
scene.backgroundIntensity = 0.10
// background map is in celestial coordinates
scene.backgroundRotation.y = EARTH_AXIS_TILT
gui.add(scene, "backgroundIntensity").min(0).max(.25).step(.01)


/**
 * Objects
 */

// Center
scene.add(new THREE.AxesHelper(3))

// Sun
const sun = new THREE.Object3D()
scene.add(sun)


// Earth
// this is a fake object for driving the moon rotation
const earth_center = new THREE.Mesh()
earth_center.position.copy(EARTH_POSITION)
sun.add(earth_center)

// this is the actual earth object
const materialEarth = new THREE.MeshStandardMaterial()
materialEarth.map = earthColorTexture
materialEarth.metalness = 0.2
materialEarth.roughness = 0.8

const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS / MOON_RADIUS, 30, 30),
    materialEarth,
)
earth.position.copy(EARTH_POSITION)
earth.rotation.y = EARTH_AXIS_TILT
sun.add(earth)


// Moon
const materialMoon = new THREE.MeshStandardMaterial()
materialMoon.map = moonColorTexture
materialMoon.envMap = scene.environment
materialMoon.displacementMap = moonHeightTexture
materialMoon.displacementScale = 0.05
materialMoon.metalness = 0.35
materialMoon.roughness = 0.60

gui.add(materialMoon, "displacementScale").min(0).max(0.1).step(.001)
gui.add(materialMoon, "metalness").min(0).max(1.).step(.01)
gui.add(materialMoon, "roughness").min(0).max(1.).step(.01)

const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 300, 300),
    materialMoon,
)
moon.position.set(
    - EARTH_MOON_DISTANCE / MOON_RADIUS,
    0, 
    0,
)
earth_center.add(moon)


// Observatory
const observatoryParameters = {
    latitude: 0, 
    longitude: -180,  // increases eastwards, planetocentric
    alpha: 24,
    zenithdistance: 0,
    azimuth: 0,  // from south increases eastward
}

function makeObservatoryGeometry(alpha) {
    const geometry = new THREE.SphereGeometry(
        FAR - 1,
        16,
        8,
        radians(90) - radians(alpha) / 2,
        radians(alpha),
        radians(90) - radians(alpha) / 2,
        radians(alpha)
    )
    return geometry
}

function getQuaternion(parameters) {
    const qLon = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, -1, 0),
        radians(parameters.longitude)
    )
    const qLat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, -1),
        radians(90 - parameters.latitude)
    )
    const qAz = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        radians(parameters.azimuth)
    )
    const qEl = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        radians(parameters.zenithdistance)
    )
    const qFix = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0)
    )
    
    const operations = [
        // rotates on ECEF south axis
        qLon, 
        // rotates on ECEF west axis
        qLat, 
        // now y axis points local up
        // and z axis points local east
        // rotates on local up axis
        qAz, 
        // rotate on local east axis
        qEl, 
        // a rotation to fix the fov location
        qFix,
    ]
    const quaternion = operations.reduce((q, p) => {
        return new THREE.Quaternion().multiplyQuaternions(q, p)
    })
    return quaternion
}

const guiObservatory = gui.addFolder('observatory')
guiObservatory
.add(observatoryParameters, "latitude").min(-90).max(+90).step(1)
.onChange(() => {
    observatory.rotation.setFromQuaternion(getQuaternion(observatoryParameters))
})
guiObservatory
.add(observatoryParameters, "longitude").min(-180).max(+180).step(1)
.onChange(() => {
    observatory.rotation.setFromQuaternion(getQuaternion(observatoryParameters))
})
guiObservatory
.add(observatoryParameters, "azimuth").min(0).max(360).step(1)
.onChange(() => {
    observatory.rotation.setFromQuaternion(getQuaternion(observatoryParameters))
})
guiObservatory
.add(observatoryParameters, "zenithdistance").min(-90).max(90).step(1)
.onChange(() => {
    observatory.rotation.setFromQuaternion(getQuaternion(observatoryParameters))
})
guiObservatory
.add(observatoryParameters, "alpha").min(0).max(+360).step(.1)
.onChange(() => {
    observatory.geometry.dispose()
    observatory.geometry =  makeObservatoryGeometry(observatoryParameters.alpha)
})

const materialObservatory = new THREE.MeshBasicMaterial({color: 0x00ff00});
materialObservatory.wireframe = true
const observatoryGeometry = makeObservatoryGeometry(observatoryParameters.alpha)
const observatory = new THREE.Mesh(observatoryGeometry, materialObservatory)
observatory.rotation.setFromQuaternion(getQuaternion(observatoryParameters))
moon.add(observatory)


/**
 * Lights
 */
const pointLight = new THREE.PointLight(0xffffff, SUN_LUMINOSITY)
pointLight.position.set(3,3,3) // TODO: WHY THIS CANT BE ZERO

const lensflare = new Lensflare()

lensflare.addElement(new LensflareElement(textureFlare0, 2048, 0))
lensflare.addElement(new LensflareElement(textureFlare1, 100, 0.3))
lensflare.addElement(new LensflareElement(textureFlare2, 75, 0.6))
lensflare.addElement(new LensflareElement(textureFlareHex, 50, 0.9))
lensflare.distance = 10

pointLight.add(lensflare)
scene.add(pointLight)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    fakeCamera.aspect = sizes.width / sizes.height
    fakeCamera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})


/**
 * Camera and Controls
 */
// Workaround for orbit control to follow moon
// Base camera
const camera = new THREE.PerspectiveCamera(
    75, sizes.width / sizes.height, 
    0.01, 
    FAR)
camera.position.x = 1
camera.position.y = 1
camera.position.z = 10
camera.lookAt(0, 0, 0)

moon.add(camera)
const fakeCamera = camera.clone();

// Controls
const controls = new OrbitControls(fakeCamera, canvas)
controls.enableDamping = true


/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))


/**
 * Animate
 */
const clock = new THREE.Clock()

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()

    // Object animations
    sun.rotation.y += 2 * Math.PI / EARTH_REVOLUTION_PERIOD * t_unit_gui.t_unit
    earth.rotation.y += 2 * Math.PI / EARTH_ROTATION_PERIOD * t_unit_gui.t_unit
    earth_center.rotation.y += 2 * Math.PI / MOON_REVOLUTION_PERIOD * t_unit_gui.t_unit

    // Update controls
    controls.update()
    camera.copy(fakeCamera)
    
    // Render
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()
