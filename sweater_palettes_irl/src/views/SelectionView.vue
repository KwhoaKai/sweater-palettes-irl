<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ImageSegmenter, ImageEmbedder, FilesetResolver, ImageSegmenterResult, ImageEmbedderOptions, GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'
import { useCounterStore } from '@/stores/counter'
import { storeToRefs } from 'pinia'
import { useIntroStore } from '@/stores/useIntroStore'
import palettesAndClusts from '@/data/palette_clust.json'
import imgMetaData from '@/data/metadata_processed.json'
import personOutline from '@/assets/person_outline.svg';
import imgEmbeddings from '@/data/image_embeddings.json'
import * as diff from "color-diff"
import { Vibrant } from "node-vibrant/browser"
import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";



/**This view receives the user's webcam feed, and sorted data
 * Pinia store
 * - last webcam image embedding and palette
 * - listing that showed up in the number 1 spot the most
 * - Array of images in top image's cluster sorted by cosine similarity, this is set to state 
 * Ascending order cosine, ascending order colorDist
 * 
 * Display the stuff like moodboard for some time
 * 
 * user moves up 
 * 
 * Cluster display
 *  Grid of panels one level up. 
 *  Panel textures are sequence images sorted to similariy with init image 
 * 
 * user moves up 
 * 
 * 
 * Cluster display 
 *   Grid of panels one level up
 *   Panel textures are sequence images sorted to similariy with init image
 * 
 * 
 */

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)

// Take the samples, get the most popular cluster out of all top 3 assignments 
// Then take that image, go to that image's cluster, and show images in descending order of 
// cosine similarity to that image
const {
  stream,
  enabled,
  searchResults,
  curEmbedding,
  clusterId,
  topImage
} = storeToRefs(useIntroStore())

const { 
  start, 
  stop, 
  setGestureRecognizer, 
  getGestureRecognizer,
  setImageEmbedder, 
  getImageEmbedder,
  setImageSegmenter, 
  getImageSegmenter,
  areTasksInitialized
} = useIntroStore()

//console.log('selectionview', searchResults.value)

const router = useRouter()
let animReqID = null
let initDataready = ref(false)
// THREEjs stuff
let showInitView = ref(false)
let threeReady = ref(false)
// let threeReady = ref(true)
let curScene = ref('SHOW_TOP_RESULT') // default scene
let scene = null
let postprocessing = {}
let camera = null
let raycaster = null
let mouse3d = null
let mesh = null
let orbit = null
let clock = null
let time = null
let delta = null
let composer = null
let renderer = null

let initThreeDone = false
// let topListing = {'key':'0_jacket-outerwear_10208-241226-0071_1024x1024_0.jpg'}
let topListing = ref(null)

// Initial scene animations 
let initSceneInstances = null
let initInstanceAnim1 = false
let initInstanceAnim2 = false
let initInstaniceAnim1ZPosTarget = -2.7
let initInstaniceAnim1ZPosInit = 0
let showMetadata = ref(false)



const initDataFormatting = () => {
  if (!searchResults.value || searchResults.value.length === 0) return 
  const counts = {}
  searchResults.value.forEach((searchResult) => {
    const curTopListing = searchResult[0]['key']

    if (counts[curTopListing]) {
      counts[curTopListing].count += 1
    } else {
      counts[curTopListing] = {
        count: 1,
        cluster: palettesAndClusts[curTopListing]?.cluster ?? null
      }
    }
  })

  const resultsArr = Object.entries(counts).map(([key, data]) => ({
    key,
    count: data.count,
    cluster: data.cluster
  }))
  resultsArr.sort((a, b) => b.count - a.count)
  let topKey = resultsArr[0]?.key
  let topProdId = topKey.split('_')[2]
  let topListingMetadataIdx = imgMetaData && Array.isArray(imgMetaData)
    ? imgMetaData.findIndex(obj => obj.product_id === topProdId)
    : -1

  let topListingMetadata = topListingMetadataIdx !== -1
    ? imgMetaData[topListingMetadataIdx]
    : {}
  topListing.value = {
    'key': topKey, 
    'cluster':resultsArr[0]?.cluster,
    'listingData': topListingMetadata
  }
  console.log('topListing', topListing.value)
}


const initPostprocessing = () => {

  let width = window.innerWidth;
  let height = window.innerHeight;

  const renderPass = new RenderPass(scene, camera)
  const bokehPass = new BokehPass(scene, camera, {
    focus: 1.0,
    aperture: 0.00003,
    maxblur: 0.01,
    width: width,
    height: height,
  });

  const composerUse = new EffectComposer(renderer)
  composer = composerUse
  // console.log(composer)
  composer.addPass(renderPass);
  composer.addPass(bokehPass);

  postprocessing.composer = composer;
  postprocessing.bokeh = bokehPass;
  threeReady.value = true
  showInitView.value = true
  // console.log(scene, 'SCENE')
}

const makeInstance = function (geom, img, data, x, y, z, xRotDir) {
  // console.log(renderer, threeReady.value)
  if(!renderer ) return 
  console.log('makeInstance', img, data)

  const texture = new THREE.TextureLoader().load(img);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const imgmat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: texture,
  });
  const obj = new THREE.Mesh(geom, imgmat);
  obj.userData = { ...data }
  
  const xRot = 60 * (Math.PI / 180); 
  const initYRot = xRot * xRotDir;
  
  // Rotation and position values
  obj.initYRot = initYRot;
  obj.targetYRot = initYRot; 
  obj.initXPos = x;
  obj.targetXPos = x;
  obj.targetZPos = z;
  obj.xRotDir = xRotDir;
  obj.position.x = x;
  obj.position.y = y;
  obj.position.z = z;
  obj.rotation.y = initYRot;
  // add texture loader as property of object
  obj.texture = texture;
  // sweaters.add(obj);
  return obj;
}

const setInstancePositionTarget = (instance, axis, target) => {
  instance[axis]=target
}

const initThree = () => {
  const canvas = document.getElementById("threeCanvas")
  let width = window.innerWidth
  let height = window.innerHeight
  canvas.width = width
  canvas.height = height
  scene = new THREE.Scene()
  const bgCol = new THREE.Color("rgb(255,255,255)")
  scene.background = bgCol
  {
    // Fog to fade out far out listings 
    const FOG_NEAR = 10;
    const FOG_FAR = 50
    const FOG_COLOR = 0xFFFFFF;
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  }
  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 50);
  raycaster = new THREE.Raycaster();
  mouse3d = new THREE.Vector2();
  
  // camera.position.z = 0;
  // camera.position.y = 1;
  // Create mesh and geometry to attach camera to for swivel view --------------------
  let camBoxGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  let camBoxMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    // overdraw: 0.5,
  });
  // Attach camera to mesh object 
  mesh = new THREE.Mesh(camBoxGeom, camBoxMat);
  // console.log(camBoxGeom);
  // mesh.position.y += 0.1;
  orbit = new THREE.Object3D();
  orbit.rotation.order = "YXZ"; // this is important to keep level, so Z should be the last axis to rotate in order...
  orbit.position.copy(mesh.position);
  scene.add(mesh);
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true, 
    alpha: false,
    powerPreference: "high-performance",
    gammaFactor: 2.2,
    outputEncoding: THREE.sRGBEncoding,
    physicallyCorrectLights: true
  });
  renderer.setSize(width, height);
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  hemiLight.position.set(0, 0, -10);
  scene.add(hemiLight);
  
  //offset the camera and add it to the pivot
  //you could adapt the code so that you can 'zoom' by changing the z value in camera.position in a mousewheel event..
  let cameraDistance = 1;
  camera.position.z = cameraDistance;
  camera.position.y = 2;
  orbit.add(camera);
  scene.add(orbit);
  // Camera follows mouse movement, handle image hovering in 3d view 
  // document.addEventListener(
  //   "mousemove",
  //   function (e) {
  //     handleCameraMovement(e);
  //     handle3dHover(e);
  //   }.bind(this)
  // );
  const dirLight = new THREE.DirectionalLight(0xffffff);
  dirLight.position.set(-3, 10, -10);
  dirLight.castShadow = true;
  dirLight.shadow.camera.top = 2;
  dirLight.shadow.camera.bottom = -2;
  dirLight.shadow.camera.left = -2;
  dirLight.shadow.camera.right = 2;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 40;
  //scene.add(dirLight);
  clock = new THREE.Clock();
  time = 0;
  delta = 0;
  let numResults = 50
  const size = numResults * 5;
  const divisions = 10;
  const gridHelper = new THREE.GridHelper(size, divisions);
  gridHelper.position.y = -1;
  gridHelper.position.z = (size/2) * -0.8;  
  gridHelper.name = "gridHelper";
  // gridHelper.postition.z = -size/2;
  scene.add(gridHelper)
  

  // Create a box geometry (1x1x1)
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

  // Create a blue basic material
  const boxMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });

  // Create the mesh from geometry and material
  const blueBox = new THREE.Mesh(boxGeometry, boxMaterial);
  
  // Position the box somewhere in front of the camera
  blueBox.position.set(1, 0, -1);
  
  // Add the box to the scene
  blueBox.name = 'blueBox'
  // scene.add(blueBox)

  initThreeDone = true
  // console.log(camera, scene)


  // Initial scene setup 
  // Top image is ready already 
  // - make top image instance and add to scene 
  // displayMetadata state variable will be set in animate 

  // Assemble palette, cluster, and embedding data for top listing 


  let topProdId = topListing.value.key.split('_')[2];
  let topListingMetadataIdx = imgMetaData && Array.isArray(imgMetaData)
    ? imgMetaData.findIndex(obj => obj.product_id === topProdId)
    : -1

  let topListingMetadata = topListingMetadataIdx !== -1
    ? imgMetaData[topListingMetadataIdx]
    : {}


  // console.log(topListingMetadata)

  const data = {
    'key': topListing.value.key,
    'cluster': palettesAndClusts[topListing.value.key]['cluster'],
    'palette': palettesAndClusts[topListing.value.key]['palette'],
    'embedding': imgEmbeddings[topListing.value.key],
    'metadata': topListingMetadata
  }

  initSceneInstances = new THREE.Group()
  const boxWidth = 4.5;
  const boxHeight = 4.5;
  const boxDepth = 0.01;
  const boxgeom = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
  const xoffset = boxWidth;
  const yoffset = 1.5 * boxHeight;
  const ypad = boxHeight * 1.1;
  const zpad = boxHeight * 0.5;
  let leftRight = 1;
  let key = data.key;
  const xloc = -xoffset * leftRight;
  const yloc = -yoffset;
  const zloc = zpad;
  // Use images resized to 512 for now 
  const source = `/src/assets/images/${key}`
  // let xRotDir = leftRight;
  let xRotDir = 0;
  // targetX = -1
  // let targetZPos = -2.7
  let initPhotoInstance = makeInstance(boxgeom, source, data,
                                        0,
                                        2,
                                        initInstaniceAnim1ZPosInit, 
                                        xRotDir)
  setInstancePositionTarget(initPhotoInstance, 'targetZPos', initInstaniceAnim1ZPosTarget)
  initInstanceAnim1 = true
  // console.log(initPhotoInstance.targetZPos)
  initPhotoInstance.name = 'topListing';
  initSceneInstances.add(initPhotoInstance)
  scene.add(initSceneInstances);
  initPostprocessing()
  // tick = 0;
  // Group for all sweater images  
}

/**
 * Handles updates to gallery objects in 3d view
 * 
 * Currently handles:
 * - Making imgs rotate towards the camera on mouseover
 * 
 *  @param {Array} objArr    Array of THREE.js Object3Ds in gallery to update 
 */
const updateTopResultScene = () => {
  const speed = 0.05;
  // console.log(initSceneInstances, 'initSceneInstances')
  if(initSceneInstances != null || initSceneInstances.children.length > 0) {
    initSceneInstances.children.forEach((obj) => {
        // const key = obj.userData.data.key;
        let curYRot = obj.rotation.y
        let curXPos = obj.position.x
        let curZPos = obj.position.z
        let targetYRot = obj.targetYRot
        let targetXPos = obj.targetXPos
        let targetZPos = obj.targetZPos
        // Update current rotation w/lerp() if not close to target
        const lerp = (x, y, a) => x * (1 - a) + y * a;
        if(initInstanceAnim1 && obj.name === 'topListing') {
          if (Math.abs(targetZPos - curZPos) < 0.08 && initInstanceAnim1) {
            obj.position.z = targetZPos
            obj.targetXPos = -2.3
            obj.targetYRot = 0.2;
            initInstanceAnim1 = false
            initInstanceAnim2 = true
            showMetadata.value = true
          }
          if (Math.abs(targetXPos - curXPos) < 0.01 && initInstanceAnim2) {
            obj.position.x = targetXPos
            initInstanceAnim2 = false;
          }
        } 
        
        const newYRot = lerp(curYRot, targetYRot, speed) ;
        const newXPos = lerp(curXPos, targetXPos, speed);
        const newZPos = lerp(curZPos, targetZPos, speed);
        // console.log(obj.position.z, targetZPos, 'init and target z')
        obj.rotation.y = newYRot;
        obj.position.x = newXPos;
        obj.position.z = newZPos;
        
      })
  }
}
/**
 * Handles updates to 3d scene at every frame of animate()
 */
const updateThree = () => {
  if(curScene.value == 'SHOW_TOP_RESULT') {
    updateTopResultScene()
  }
}

const getCurrentScene = () => {
  return curScene.value
}


const animate = () => {
    // threeready.value should be true by the time this is called
    if(threeReady.value) {
      updateThree()
      composer.render()
      const RANGE = 0.09;
      const SCALE = 0.1;
      const Z_SCROLL = 0.004;
      const Z_STOP_MULT = .5;
      const Z_MOVE = Z_SCROLL;
      // let blueBox = scene.getObjectByName('blueBox')
      // console.log(blueBox)
      // console.log('inanimate')
      // blueBox.rotation.y += .1
      
    }

    // camera.position.z -= Z_SCROLL;
    // mesh.position.z -= Z_MOVE;
    // orbit.position.z -= Z_MOVE;
    // Idle bob object that camera is attached to
    // orbit.position.x = Math.cos(tick) * range;
    // orbit.position.y = Math.sin(tick) * range;
    // tick += 0.01;
  // } 
  animReqID = requestAnimationFrame(animate)
}


onMounted(() => {
  console.log('before datafomratting')
  initDataFormatting()
  console.log('after datafor', topListing.value)
  initThree()
  animate()
})

onBeforeUnmount(() => {
  // stopWebcam()
})

// Year text display
const displaySeasonYear = computed(() => {
  if (!topListing.value) return '';
  const listingCur = topListing.value?.listingData
  if (!listingCur) return '';

  let finalStr = ''
  if(listingCur.year) {
    finalStr += `${listingCur.year} `
  } else if(listingCur.years_ago) {
    finalStr += listingCur.years_ago.toString()
  }
  if(listingCur.season_code) {
    finalStr += listingCur.season_code
  }
  return finalStr;
});


</script>
<template>
  <main>
    <transition name='fadeEaseOut'>
      <v-container v-show="showInitView" fluid id="containerDiv" class="App">

        <transition name='fadeEaseOut'>
          <v-row v-show='showMetadata' id='topInfoRow' class="pad-bot-2">
            <v-col id="titleDiv" :md="5" :lg="4" class="mr-auto">
              <h1>{{ topListing?.listingData?.brand }}</h1>
              <h1>{{ displaySeasonYear }}</h1> 
            </v-col>
            <v-col id='listingInfoDiv' :md="5" :lg="6" class="ml-auto pad-right-2">
              <span>
                <h1>{{ topListing?.listingData?.item_name }}</h1>
                <h1>{{ topListing?.listingData?.item_price }}</h1>
                <h1>${{ topListing?.listingData?.item_price_usd_int }}</h1>
              </span>
              <p style="white-space: pre-line">{{ topListing?.listingData?.item_description }}</p>
              </v-col>
          </v-row>
        </transition>
        <canvas id="threeCanvas"></canvas>
      </v-container>
    </transition>
    <!-- <video ref="videoRef" autoplay playsinline></video> -->
  </main>
</template>

<style scoped>
#threeCanvas {
  position: fixed;
  padding: 0;
  margin: 0;

  top: 0;
  left: 0;

  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.5);

  z-index: -5;
}

.fadeEaseOut-enter-active,
.fadeEaseOut-leave-active {
  transition: opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.fadeEaseOut-enter-from,
.fadeEaseOut-leave-to {
  opacity: 0;
}

.fadeEaseOut-enter-to,
.fadeEaseOut-leave-from {
  opacity: 1;
}

.pad-right-2 {
  padding-right: 2em;
}

#containerDiv {
  height: 100%;
  width: 100%;
}

html {
  height: 100%;
  width: 100%;
  font-size: 62.5%;
  /* min-width: 1040px; */
}

body {
  text-align: center;
  height: 100%;
  width: 100%;
  max-width: 1350px;
  margin: auto;
  /* overflow-y: hidden; */
}

#topInfoRow {
  padding-top: 1em;
  padding-bottom: 1em;
  padding-right: 1em;
  padding-left: 1em;
}

#listingInfoDiv {
  padding-right: 10rem;
  padding-left: 8rem
}

#app {
  font-family: proxima-nova, sans-serif;
  font-weight: 400;
  font-style: normal;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  /* color: #2c3e50; */
  color: black;
  background-color: blue;
  /* margin-top: 3%; */
  width: 100%;
  height: 100%;
}
</style>