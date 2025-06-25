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
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { en } from 'vuetify/locale'

const {
  stream,
  enabled,
  searchResults,
  clusterId,
  topImage,
  finalUserPalette,
  curEmbedding
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
} = useIntroStore()

console.log(enabled.value, ' intro store ')
// console.log(introStore.gestureRecognizer, 'gesture recognizer')
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)
const countsData = ref({})
// const curEmbedding = ref({})
const router = useRouter()
const distMapUse = ref({})
const userPaletteRgb = ref([])
// const paletteContainer = ref<HTMLDivElement | null>(null)
const allListingData = ref({})
const webcamButtonText = ref('ENABLE WEBCAM')
let startTransitionToNextScene = ref(false)
// let imageSegmenter: ImageSegmenter
// let imageEmbedder: ImageEmbedder
// let gestureRecognizer: GestureRecognizer


// let stream: MediaStream | null = null
let lastTriggerTime = 0;
const INTERVAL = 2000; // ms
let lastVideoTime = -1

// Handle user inframe timing
let searchResultsReady = ref(false)
const userInFrame = ref(false)
const searchResultsReadyThreshold = 27
let userInFrameFrameBuffer = []
const showStartGesture = ref(false)
const COLLECTION_DURATION_MS = 1000

let animReqID = null


// THREEjs stuff
let animateStarted = false
let threeReady = false
let scene = null
let postprocessing = {}
let bgCol = null
let camera = null
let raycaster = null
let mouse3d = null
let mesh = null
let orbit = null
let clock = null
let time = null
let delta = null
let sweaters = null
let composer = null
let startGestureInFrame = ref(false)
let renderer = null
let initThreeDone = false



// router shit
// ----------------------------------------------------------------------
// const router = useRouter()
// const shouldRedirect = ref(false)

// // Watch the boolean ref
// watch(shouldRedirect, (newVal) => {
//   if (newVal) {
//     router.push('/selection') // or any other route path
//   }
// })

// Simulate flipping the boolean after 3 seconds
// setTimeout(() => {
//   shouldRedirect.value = true
// }, 3000)
// ----------------------------------------------------------------------

// const clearUserInFrameCount = () => {
//   userInFrameFrameBuffer = []
// }

// const startCollectingFrames = () => {
//   // collecting.value = true;
//   frameBuffer.value = [];

  
// }

watch(startTransitionToNextScene, (newVal) => {
  if (newVal) {
    setTimeout(() => {
      router.push('/selection')
    }, 300)
  }
})

const createGestureRecognizer = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  const recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU"
    },
    runningMode: 'VIDEO'
  });
  
  setGestureRecognizer(recognizer)
};

const setupEmbedder = async () => {
  const fileset = await FilesetResolver.forVisionTasks(
    'node_modules/@mediapipe/tasks-vision/wasm'
  )

  const embedder = await ImageEmbedder.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/1/mobilenet_v3_large.tflite',
      delegate: 'GPU'
    },
    runningMode: 'IMAGE',
    quantize: false,
    l2Normalize: true,
  })
  
  setImageEmbedder(embedder)
}

const setupSegmenter = async () => {
  const fileset = await FilesetResolver.forVisionTasks('node_modules/@mediapipe/tasks-vision/wasm')
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
  })
  
  setImageSegmenter(segmenter)
}

const animate = () => {
  predictWebcam()
  // Only run animation loop if canvas is shown 
  // if(this.currentView.GALLERY_VIEW) {
    // required if controls.enableDamping or controls.autoRotate are set to true
    // this.renderer.render(this.scene, this.camera); 
    // const animReqID = requestAnimationFrame(animate)
    // console.log
    // this.updateThree();
    if(threeReady) {
      // console.log(composer, 'compser')
      // console.log(camera, 'fuck')
      // console.log(scene, ' SCENE')
      // composer.renderer.render();
      // composer.render()
      const RANGE = 0.09;
      const SCALE = 0.1;
      const Z_SCROLL = 0.004;
      const Z_STOP_MULT = .5;
      const Z_MOVE = Z_SCROLL;
      let blueBox = scene.getObjectByName('blueBox')
      // console.log(blueBox)
      // console.log('inanimate')
      blueBox.rotation.y += .1
    }

    // this.camera.position.z -= Z_SCROLL;
    // this.mesh.position.z -= Z_MOVE;
    // this.orbit.position.z -= Z_MOVE;
    // Idle bob object that camera is attached to
    // this.orbit.position.x = Math.cos(this.tick) * range;
    // this.orbit.position.y = Math.sin(this.tick) * range;
    // this.tick += 0.01;
  // } 
  animReqID = requestAnimationFrame(animate)
}

const startWebcam = async () => {
  if (!videoRef.value || !canvasRef.value) return

  try {
    // stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.value = await start()
    videoRef.value.srcObject = stream.value
    enabled.value = true
    webcamButtonText.value = 'DISABLE WEBCAM'

    videoRef.value.addEventListener('loadedmetadata', () => {
      resizeCanvas()
      videoRef.value?.play()
      if(animReqID !== null) {
        cancelAnimationFrame(animReqID)
      }
      animate()
      // requestAnimationFrame(animate)
    })
  } catch (e) {
    console.error('Webcam error:', e)
  }
}

const stopWebcam = () => {
  stream.value?.getTracks().forEach((track) => track.stop())
  stream.value = null
  enabled.value = false
  webcamButtonText.value = 'ENABLE WEBCAM'
}

const toggleWebcam = async () => {
  if (enabled.value) {
    stopWebcam()
    if(animReqID !== null) {
      cancelAnimationFrame(animReqID)
    }
  } else {
    await setupEmbedder()
    await setupSegmenter()
    await createGestureRecognizer()
    await startWebcam()
  }
}

const resizeCanvas = () => {
  if (!videoRef.value || !canvasRef.value) return
  const video = videoRef.value
  const canvas = canvasRef.value
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
}

function imageDataToImageElement(imageData: ImageData): HTMLImageElement {
// Function converts ImageData to <img> 
//   
  // Step 1: Create a canvas
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is null');

  // Step 2: Put the image data onto the canvas
  ctx.putImageData(imageData, 0, 0);

  // Step 3: Convert canvas to Data URL
  const dataUrl = canvas.toDataURL();

  // Step 4: Create an image element
  const img = new Image();
  img.src = dataUrl;

  return img;
}

function shouldRun(interval, lastRunTime) {
  const now = performance.now();
  // console.log(now - lastRunTime)
  if (now - lastRunTime >= interval) {
    return [true, now];
  }
  return [false, lastRunTime];
}

function cosineSimilarity(A, B) {
  if (A.length !== B.length) {
    throw new Error("Vectors must be the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0; // or handle zero-vector case as needed
  }

  return dotProduct / (normA * normB);
}


/**
 * Returns minimum CIEDE200 color difference between col and all colors in pal
 * @param {obj} col    Should have fields r,g,b
 * @param {Array} pal  Should be array of objects with fields r,g,b
 */
const getMinDist = function(col, pal) {

  // let labCol = diff.rgb_to_lab(col);
  let minColDist = Infinity;

  // Iterate through colors and save minimum distance
  for (let i = 0; i < pal.length; i++) {
    // let palColLab = diff.rgb_to_lab(pal[i]);
    let colDiff = diff.diff(pal[i], col);
    minColDist = Math.min(colDiff, minColDist);
  }
  return minColDist;
}


/**
 * Return MICDP distance between two color palettes.
 * Palettes should have the same number of colors.
 * @param {Array} pal1    Should be array of objects with fields r,g,b
 * @param {Array} pal2    Should be array of objects with fields r,g,b
 */
const getPalDist = function(pal1, pal2) {
  // console.log(pal1, pal2)
  const numCol = pal1.length
  let pal1MinDists = []
  let pal2MinDists = []

  // Get minimum distance for each color in both palettes
  for (let i = 0; i < numCol; i++) {
    let pal1Col = pal1[i]
    let minDist1 = getMinDist(pal1Col, pal2)
    pal1MinDists.push(minDist1);

    let pal2Col = pal1[2]
    let minDist2 = getMinDist(pal2Col, pal1);
    pal2MinDists.push(minDist2);
  }
  let distSumPal1 = pal1MinDists.reduce((a, b) => {
    return a + b;
  });

  let distSumPal2 = pal2MinDists.reduce((a, b) => {
    return a + b;
  });

  // Calculate MIDCP
  let distAvgPal1 = distSumPal1 / numCol;
  let distAvgPal2 = distSumPal2 / numCol;
  let grandAvg = (distAvgPal1 + distAvgPal2) / 2;
  return grandAvg;
}

function quantizeEmbedding(embedding) {
  return embedding.map(x => Math.round((x + 1) * 127.5)); // to uint8
}

function dequantizeEmbedding(qEmbedding) {
  return qEmbedding.map(x => (x / 127.5) - 1);
}

const predictWebcam = async () => {
  const imageSegmenter = getImageSegmenter()
  const gestureRecognizer = getGestureRecognizer()
  const imageEmbedder = getImageEmbedder()
  // console.log(imageSegmenter, gestureRecognizer, imageEmbedder)
  if (!enabled.value || !videoRef.value || !canvasRef.value || !maskCanvasRef.value || !imageSegmenter) return

  const video = videoRef.value
  const canvas = canvasRef.value
  const maskCanvas = maskCanvasRef.value
  const ctx = canvas.getContext('2d')
  const ctxMask = maskCanvas.getContext('2d')
  if (!ctx) return

  try {
    const result: ImageSegmenterResult = await imageSegmenter.segmentForVideo(
      video,
      performance.now(),
    )
    const mask = result.categoryMask.getAsUint8Array()
    const { width, height } = result.categoryMask
    result.categoryMask.close();


    // ctx.setTransform(-1, 0, 0, 1, canvas.width, 0); 
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Unflip canvas before pixel manipulation
    // ctx.setTransform(1, 0, 0, 1, 0, 0)

    // 3. Get image data (raw pixel buffer)
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 4. Process mask
    let uniqueMaskLabels = new Set(mask);
    userInFrame.value = uniqueMaskLabels.has(4);

    const colors = [
      [0, 0, 0, 50],
      [255, 0, 0, 100],
      [0, 255, 0, 100],
      [0, 0, 255, 100],
    ]

    // Show proportion of masked pixels from each label
    let maskLabels = []
    let maskPixels = []
    let selectedMask = 4

    // Iterate over mask-classified pixels
    // white out non-masked pixels for embeddings
    // Alpha out non-masked pixels for color palette extraction
    for (let i = 0; i < mask.length; i++) {
      const category = mask[i]
      maskLabels.push(category)
      const color = colors[category] || [255, 255, 255, 100]
      const pixelIndex = i * 4

      if(category == selectedMask) {
      } else {
        data[pixelIndex] = 255
        data[pixelIndex + 1] = 255
        data[pixelIndex + 2] = 255
        data[pixelIndex + 3] = 255
      }
    }
    let imgWidth = imageData.width;
    let imgHeight = imageData.height;
    const rowLength = imgWidth * 4;

    for (let y = 0; y < imgHeight; y++) {
      const rowStart = y * rowLength;
      let left = 0;
      let right = imgWidth - 1;

      while (left < right) {
        const leftIndex = rowStart + left * 4;
        const rightIndex = rowStart + right * 4;

        // Swap RGBA values between left and right pixels
        for (let i = 0; i < 4; i++) {
          const temp = data[leftIndex + i];
          data[leftIndex + i] = data[rightIndex + i];
          data[rightIndex + i] = temp;
        }

        left++;
        right--;
      }
    }
    ctx.putImageData(imageData, 0, 0)
    ctx.save()

    if(userInFrame.value && !showStartGesture.value) {
      // console.log('starting timer')
      // collectingStarted = true
      setTimeout(() => { 
        const totalFrames = userInFrameFrameBuffer.length
        const maskFrames = userInFrameFrameBuffer.filter(x => x).length

        if (totalFrames > 0) {
          // console.log(maskFrames / totalFrames);
          if(maskFrames / totalFrames > 0.85) {
            // userInFrameFrameBuffer = []
            showStartGesture.value = true
          }
          showStartGesture.value = false
        } else {
          showStartGesture.value = false
        }
        // collectingStarted = false
        // console.log(totalFrames)
      }, COLLECTION_DURATION_MS); // <-- delay in milliseconds (2 seconds)
    }
    // if(userInFrame.value && collectingStarted) {
    if(userInFrame.value) {
      // console.log('pushing')
      userInFrameFrameBuffer.push(uniqueMaskLabels.has(4))
    }

    // Clone masked imageData, used to create a second image without background
    // const clonedData = new Uint8ClampedArray(imageData.data); // deep copy
    // const clonedImageData = new ImageData(clonedData, imageData.width, imageData.height);

    // const labels = introStore.imageSegmenter.value.getLabels?.() ?? []

    
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0); 
    let results = null
    let nowInMs = Date.now();
      if(gestureRecognizer != null) {
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          // console.log(gestureRecognizer.value, 'GOGOOGO')
          results = gestureRecognizer.recognizeForVideo(video, nowInMs);
        }
        const drawingUtils = new DrawingUtils(ctx)
        if (results?.landmarks != null) {
          let curClass = results?.gestures?.[0]?.[0]?.categoryName ?? null
          // console.log(curClass)
          
          if(curClass != 'Victory') {
            // Check if results are ready 
            if(searchResultsReady.value && startGestureInFrame.value) {
              startTransitionToNextScene.value = true
            }


            // startGestureInFrame.value = false
            for (const landmarks of results.landmarks) {
              console.log("doing this stuff")
              drawingUtils.drawConnectors(
                landmarks,
                GestureRecognizer.HAND_CONNECTIONS,
                {
                  color: "#000000",
                  lineWidth: 1
                }
              );
              drawingUtils.drawLandmarks(landmarks, {
                color: "#000000",
                lineWidth: 0.5
              });
            }
          } else {
            
            for (const landmarks of results.landmarks) {
              landmarks.forEach((point, index) => {
                const x = point.x * ctx.canvas.width;
                const y = point.y * ctx.canvas.height;

                // Example: label each point with its index
                ctx.font = "16px sans-serif";
                ctx.fillStyle = "black";
                
                // ctx.fillText(`✌️ ${index}`, x - 10, y + 10);
                if(index == 9) {
                  ctx.font = "120px sans-serif";
                  ctx.fillText(`✌️`, x - 10, y + 10);
                }
              });
              // startGestureInFrame.value = true
            }
          }
          startGestureInFrame.value = curClass == 'Victory'
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        // ctx.restore();
      }

    // Draw clothing masked image to canvas

    // Create <img> for color palette extraction if user has no palette and interval is met
    let [shouldTrigger, newTime] = shouldRun(0, lastTriggerTime);
    if (shouldTrigger) {
      lastTriggerTime = newTime;
      // console.log('interval passed');
    }

    // 
    if ((!userPaletteRgb.values || userPaletteRgb.values.length === 0) && shouldTrigger) {
      const canvasPalette = document.createElement('canvas')
      canvasPalette.width = imageData.width;
      canvasPalette.height = imageData.height;
      const ctxPalette = canvasPalette.getContext('2d')
      ctxPalette.putImageData(imageData, 0, 0)
      const dataUrl = canvasPalette.toDataURL()
      const img = new Image()
      img.src = dataUrl
      img.style.width = '512px'
      img.style.margin = '10px'


      // Color palette shit 
      let v = new Vibrant(dataUrl);
      let palette = await v.getPalette()
      const paletteArr = Object.values(palette)
                          .filter(swatch => swatch) // remove any null swatches
                          .sort((a, b) => b._population - a._population) // descending order
  
      const rgbPalettes = paletteArr.slice(0,5).reduce((acc, curr) => {
        const rgb = curr._rgb
        acc.push(rgb)
        return acc
      }, [])
      // console.log(rgbPalettes);
      userPaletteRgb.value = rgbPalettes
    }

    let labelPercentages = maskLabels
    let categories = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others']

    // Get proportion of masks to total image 
    const counts = maskLabels.reduce((acc, val) => {
      let category = categories[val]
      acc[category] = (acc[category] || 0) + 1
      return acc
    }, {})
    countsData.value = counts
    // console.log(countsData.value)

    

    // Calculate cosine similarity
    const userVideoEmbedding = await imageEmbedder.embed(imageData)
    const userVideoEmbeddingFloatArr = userVideoEmbedding.embeddings[0].floatEmbedding
    curEmbedding.value = userVideoEmbedding
    const imgKeys = Object.keys(imgEmbeddings)
    if(shouldTrigger && startGestureInFrame.value) {
      // Calculate palette and embedding similarities
      let distMap = []
      let palCtBad = 0
      let palCtGood = 0
      let cats = new Set()
      imgKeys.forEach((key) => {
        let photoIdx = key.split('_').slice(-1)[0][0]
        let category = key.split('_')[1]
        cats.add(category)
        // console.log(photoIdx, category)
        const listingCategories = ['tops']
        // const listingCategories = ['jacket-outerwear', 'tops', 'others', 'bottoms']
        // const listingCategories = ['others']
        if (listingCategories.includes(category) && Number(photoIdx) == 0 && userPaletteRgb.value.length > 0) {
          // try {
            // console.log(key)
            const deQuantizedEmbedding = dequantizeEmbedding(imgEmbeddings[key]); // array of floats
            // console.log(userVideoEmbeddingFloatArr, deQuantizedEmbedding);
            const similarityCosine = cosineSimilarity(userVideoEmbeddingFloatArr, deQuantizedEmbedding)
            let imgPalette = palettesAndClusts[key]?.palette ?? null
            let parsedImgPalette = JSON.parse(imgPalette)
  
            // Return null if image doesn't have color palette
            const imgPaletteFormatted = imgPalette == null 
              ? null
              : parsedImgPalette.map(([r, g, b]) => ({ r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) }))
  
            // Return null if user image has no color palette
            const userPaletteFormatted = userPaletteRgb.value.length === 0
              ? null
              : userPaletteRgb.value.map(([r, g, b]) => ({ r, g, b }))
  
            // Compute similarity only if both palettes exist
            // console.log(userPaletteFormatted[0], imgPaletteFormatted[0], 'ufccc')
            const similarityColor = (userPaletteFormatted && imgPaletteFormatted)
              ? getPalDist(userPaletteFormatted, imgPaletteFormatted)
              : null;
  
            if (imgPalette == null) {
              palCtBad += 1
            } else {
              palCtGood += 1
            }
  
            distMap.push({
              key: key,
              similarityCosine: similarityCosine,
              similarityColor: similarityColor,
              palette: parsedImgPalette
            })     
        }
        // console.log(`Similarity for ${key}:`, similarity);
      });
      const getFinalImages = function(imageDict, firstSort, secondSort, nResults) {
        let filteredDistMap = imageDict.filter(item => item.similarityColor != null)
        let secondFilt = firstSort == 'cosine' ? 'color' : 'cosine'
        let firstSortDists = firstSort == 'cosine'
        ? filteredDistMap.sort((a, b) => a.similarityCosine - b.similarityCosine)
        : filteredDistMap.sort((a, b) => a.similarityColor - b.similarityColor)
        
        let limitedDists = filteredDistMap.slice(0, 50)
        let limitedSort = firstFilt == 'cosine'
        ? limitedDists.sort((a, b) => a.similarityColor - b.similarityColor)
        : limitedDists.sort((a, b) => a.similarityCosine - b.similarityCosine)
  
        return limitedDists.slice(0, nResults)
      }
  
      let firstFilt = 'cosine'
      let secondFilt = firstFilt == 'cosine' ? 'color' : 'cosine'
      let finalImages = getFinalImages(distMap, firstFilt, secondFilt, 30)
      searchResults.value.push(finalImages)
      if (searchResults.value.length > searchResultsReadyThreshold) {
        searchResultsReady.value = true
        finalUserPalette.value = userPaletteRgb.value
        searchResults.value.pop()
      }



      // let windowHeight = window.innerHeight
      // let windowWidth = window.innerWidth

      // let imgWidth = 500
      // let imgHeight = imgWidth

      // let nCols = windowWidth / imgWidth
      // let nRows = Math.ceil(finalImages.length / nCols)

      // let grid = []

      // for(let i=0; i<nCols; i++) {
      //   for(let j=0; j<nRows; j++) {
      //     let idx = i*nCols + j
      //     if(idx < finalImages.length) {
      //       finalImages[idx].x = i * imgWidth + imgWidth/2
      //       finalImages[idx].y = j * imgHeight + imgHeight/2
      //       finalImages[idx].width = imgWidth * 0.8
      //     }
      //   }
      // }


      finalImages = finalImages.map((item) => {
        return {
          ...item,
          // x: Math.random()*window.innerWidth*0.8 + 100,
          // y: Math.random()*window.innerHeight*0.9 + 100,
          width: 300

        }
      })
      // console.log(finalImages)
      distMapUse.value = finalImages
    }
    // Empty results if 
    if((!startGestureInFrame.value && !searchResultsReady.value) || searchResults.value.length > 100) {
      searchResults.value = []
    }

    try {
    } catch (e) {

    }
  } catch (e) {
    console.warn('predictWebcam() failed: ', e)
  }
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
  threeReady = true
}

const initThree = () => {
  const canvas = document.getElementById("threeCanvas")
  let width = window.innerWidth
  let height = window.innerHeight
  canvas.width = width
  canvas.height = height
  scene = new THREE.Scene()
  const bgCol = new THREE.Color("rgb(255, 255, 255)")
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
  scene.add(blueBox)



  initThreeDone = true
  // console.log(camera, scene)
  initPostprocessing()
  // tick = 0;
  // Group for all sweater images 
  // sweaters = new THREE.Group();
}

onMounted(() => {
  initThree()
})

onBeforeUnmount(() => {
  stopWebcam()
})
</script>

<template>
  <transition name="fadeEaseOut">
  <v-container v-if="!startTransitionToNextScene" fluid id="containerDiv" class="App">
    <v-row class="pad-bot-2">
      <v-col id="titleDiv" :md="5" :lg="6" :class="{ 'alpha-05': startGestureInFrame}">
        <!-- <h1 class="titleText">ARCHIVE</h1>
        <h1 class="titleText">PALETTESS</h1> -->
        <h1 class="titleText">Real-time Similarity Search via Image Segmentation and Encoding</h1>
        <br>
        <!-- <h2>Archive Store JP - Interactive Index</h2> -->
        <!-- <h1 class="titleText">PALETTESS</h1> -->
      </v-col>
      <!-- <v-spacer></v-spacer> -->
    </v-row>
    <button @click="toggleWebcam">
      {{ webcamButtonText }}
    </button>
    <v-row id="webcamRow">
      <div>
        <transition name="fade">
        <span id="firstDirection" class="textDirections" :class="{ 'alpha-05': startGestureInFrame }">
            <h1>Search Archive Store</h1>
            <p style="font-size: 2rem">
              Center yourself in frame and do this '✌️'
            </p>
          </span>
        </transition>
        <span id="secondDirection" class="textDirections">
          <transition name="fade" style="font-size: 1.5rem">
            <p v-if="showStartGesture">Hold that pose...</p>
          </transition>
        </span>
        
      </div>
      
      <div  
        class="webcam-container"
        :class="{ 'scale-15': startGestureInFrame }">
        <!-- <img id='personOutline' :src="personOutline" alt="Person Outline" /> -->
        <video
            ref="videoRef"
            autoplay
            muted
            playsinline
            style="transform: scaleX(-1); opacity: 1;"
          ></video>
        <canvas ref="canvasRef"></canvas>
        <canvas ref="maskCanvasRef"></canvas>
      </div>
      <!-- <img src="personOutline" alt="My SVG" /> -->
    </v-row>
    <div id='userPaletteRow' class="palette-row" :class="{'alpha-05': startGestureInFrame}">
      <div
        v-for="(rgb, index) in userPaletteRgb"
        :key="index"
        class="color-block"
        :style="{ backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` }"
      ></div>
    </div>

    <!-- <transition name="fade"> -->
      <canvas id="threeCanvas"></canvas>
    <!-- </transition> -->

    <!-- <transition name="fade-scale"> -->
      <div
        id="photoDiv"
        :class="{ 'scale-1': startGestureInFrame}"
      >
        <div
          v-for="(item, index) in distMapUse"
          :key="item.key"
          class="fade-item"
          style="margin: 5px"
        >
          <img
            :src="`/src/assets/images/${item.key}`"
            :alt="item.key"
            :style="{ width: `${item.width}px` }"
          />
          <div
            v-if="item.palette && Array.isArray(item.palette)"
            style="display: flex; margin-top: 5px; align-items: center;"
          >
            <div
              v-for="(color, idx) in item.palette"
              :key="idx"
              :style="{
                width: '15px',
                height: '15px',
                backgroundColor: `rgb(${color[0]*255}, ${color[1]*255}, ${color[2]*255})`,
                border: '1px solid #000',
                marginRight: '4px'
              }"
            ></div>
          </div>
        </div>
      </div>
    <!-- </transition> -->
  </v-container>
  </transition>
</template>


<style scoped>
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

#titleDiv {
  opacity: 1;
  transition: opacity 1.5s cubic-bezier(0.01, 0.8, 0.5, 0.96)
}

.fullOpacity {
  opacity: 1;
}

.alpha-05 {
  opacity: 0.0;
}

#titleDiv.alpha-05 {
  opacity: 0.0;
}

#photoDiv {
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;

  /* transform: translate(3%, -20%); */
  transform: translate(3%, -14.5%) scale(0.95);
  opacity: 0;
  z-index: -1;
  transition: transform 1s cubic-bezier(0.01, 0.95, 0.5, 0.96), opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

#photoDiv.scale-1 {
  transform: translate(3%, -14.5%) scale(1);
  opacity: 1;
  z-index: -1; /* bump z-index so it appears */
}

#userPaletteRow {
  opacity: 1;
  transition: opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

#userPaletteRow.alpha-05 {
  opacity: 0.0;
}

#containerDiv {
  height: 100%;
  width: 100%;
}

#webcamRow {
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

.titleText {
  font-size: 4.5em;
  line-height: 0.85em;
  font-weight: 400;
  margin: 0px auto 0px auto;
  color: black;
}

@media screen and (min-width: 1280px) {
  .titleText {
    font-size: 4.5em;
    line-height: 0.85em;
    font-weight: 400;
    margin: 0px auto 0px auto;
  }

  /* .stepText {
    font-family: proxima-nova, sans-serif;
    font-size: 2em;
    font-weight: 300;
  }

  .introGifWidth {
    width: 30rem;
  } */
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}

.fade-container {
  display: flex;
  flex-direction: column; /* or 'row' depending on your use case */
  gap: 16px; /* optional spacing */
}

.fade-item {
  /* your item styling here */
}

.fadein {
  transition-property: opacity;
  transition-duration: 0s;
}




.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease !important;
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.1);
}
.fade-scale-enter-to,
.fade-scale-leave-from {
  opacity: 1;
  transform: scale(1);
}



#container {
  margin: 0%;
}

.pad-bot-2 {
  padding-bottom: 1.5em;
}

#canvas {
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

#personOutline {
  position: absolute;
  width: 600px;
}



.route-fade-overlay {
  position: fixed;
  inset: 0;
  background: white;
  z-index: 9999;
}


.webcam-container {
  position: absolute;
  top: 150px; /* instead of translateY */
  left: 50%;
  transform: translate(-50%, 40%) scale(1);
  /* transform: translateY(50%); */
  
  width: 650px;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.231);
  border-radius: 50%; /* perfect circle */
  z-index: 100000;

  /* transition: transform 0.15s ease; */
  transition: transform 2.5s cubic-bezier(0.01, 0.9, 0.5, 0.96)
}

/* .scale-15 {
  transform: translate(-50%, 40%) scale(1.15);
} */

.scale-15 {
  transform: translate(-50%, 42%) scale(.9);
}

.textDirections {
  position: absolute;
  left: 50%;
  z-index: 1000;
  /* transform: translateY(50%); */
}

#firstDirection {
  top: 150px; 
  transform: translate(-50%, 125%);
  opacity: 1;
  transition: opacity 1s cubic-bezier(0.01, 0.8, 0.5, 0.96)
}

#firstDirection.alpha-05 {
  opacity: 0.01;
}

#secondDirection {
  /* top: 150px;  */
  transform: translate(-50%, 225%);
}


video,
canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 1; 
  top: 0;
  left: 0;
}

.webcam-container-alpha {
  opacity: 0.4;
  transition-property: opacity;
  transition-duration: 0.1s;
}

button {
  margin-bottom: 12px;
}

.palette-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.color-block {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid #ccc;
}


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
</style>