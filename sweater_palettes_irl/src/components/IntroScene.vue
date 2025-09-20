<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ImageSegmenter, ImageEmbedder, FilesetResolver, ImageSegmenterResult, ImageEmbedderOptions, GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'
import { useCounterStore } from '@/stores/counter'
import { storeToRefs } from 'pinia'
import { useIntroStore } from '@/stores/useIntroStore'
import { getPalDist } from "@/utils/imageProcessingUtils"
import { dequantizeEmbedding, cosineSimilarity } from "@/utils/embeddingProcessingUtils"
import palettesAndClusts from '@/data/palette_clust.json'
import imgMetaData from '@/data/metadata_processed.json'
import personOutline from '@/assets/person_outline.svg';
import imgEmbeddings from '@/data/image_embeddings.json'
import * as diff from "color-diff"
import { Vibrant } from "node-vibrant/browser"

const {
  stream,
  camEnabled,
  searchResults,
  clusterId,
  topImage,
  finalUserPalette,
  curCamFrameEmbedding
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

console.log(camEnabled.value, ' intro store ')
// console.log(introStore.gestureRecognizer, 'gesture recognizer')
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)
const countsData = ref({})
// const curCamFrameEmbedding = ref({})
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
let animReqID: number | null = null;
let startGestureInFrame = ref(false)


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
  interactionLoop()
  animReqID = requestAnimationFrame(animate)
}

const startWebcam = async () => {
  if (!videoRef.value || !canvasRef.value) return

  try {
    // stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.value = await start()
    videoRef.value.srcObject = stream.value
    camEnabled.value = true
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
  camEnabled.value = false
  webcamButtonText.value = 'ENABLE WEBCAM'
}

const toggleWebcam = async () => {
  if (camEnabled.value) {
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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

function shouldRun(interval: any, lastRunTime) {
  const now = performance.now();
  // console.log(now - lastRunTime)
  if (now - lastRunTime >= interval) {
    return [true, now];
  }
  return [false, lastRunTime];
}

const interactionLoop = async () => {
  const imageSegmenter = getImageSegmenter()
  const gestureRecognizer = getGestureRecognizer()
  const imageEmbedder = getImageEmbedder()
  // console.log(imageSegmenter, gestureRecognizer, imageEmbedder)
  if (!camEnabled.value || !videoRef.value || !canvasRef.value || !maskCanvasRef.value || !imageSegmenter) return

  const video = videoRef.value
  const canvas = canvasRef.value
  const maskCanvas = maskCanvasRef.value
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const ctxMask = maskCanvas.getContext('2d', { willReadFrequently: true });
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


    // Start gesture stuff, dumb 

    // if(userInFrame.value && !showStartGesture.value) {
    //   // console.log('starting timer')
    //   // collectingStarted = true
    //   setTimeout(() => { 
    //     const totalFrames = userInFrameFrameBuffer.length
    //     const maskFrames = userInFrameFrameBuffer.filter(x => x).length

    //     if (totalFrames > 0) {
    //       // console.log(maskFrames / totalFrames);
    //       if(maskFrames / totalFrames > 0.85) {
    //         // userInFrameFrameBuffer = []
    //         showStartGesture.value = true
    //       }
    //       showStartGesture.value = false
    //     } else {
    //       showStartGesture.value = false
    //     }
    //     // collectingStarted = false
    //     // console.log(totalFrames)
    //   }, COLLECTION_DURATION_MS); // <-- delay in milliseconds (2 seconds)
    // }
    // // if(userInFrame.value && collectingStarted) {
    // if(userInFrame.value) {
    //   // console.log(userInFrameFrameBuffer.length, 'wtf lol')
    //   // console.log('pushing')
    //   // console.log('uniquemaskalbels', uniqueMaskLabels.has(4))
    //   userInFrameFrameBuffer.push(uniqueMaskLabels.has(4))
    // }

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
      const ctxPalette = canvasPalette.getContext('2d', { willReadFrequently: true });
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
    curCamFrameEmbedding.value = userVideoEmbedding
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
            // console.log('similarityCOsine',userVideoEmbeddingFloatArr, deQuantizedEmbedding)
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
            console.log('similarityColor', userPaletteFormatted, imgPaletteFormatted)
  
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
        ? filteredDistMap.sort((a, b) => b.similarityCosine - a.similarityCosine)
        : filteredDistMap.sort((a, b) => b.similarityColor - a.similarityColor)
        
        let limitedDists = filteredDistMap.slice(0, 50)
        let limitedSort = firstFilt == 'cosine'
        ? limitedDists.sort((a, b) => b.similarityColor - a.similarityColor)
        : limitedDists.sort((a, b) => b.similarityCosine - a.similarityCosine)
  
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
    console.warn('interactionLoop() failed: ', e)
  }
}

onMounted(() => {
  console.log('IntroScene mounted')
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