<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { ImageSegmenter, ImageEmbedder, FilesetResolver, ImageSegmenterResult, ImageEmbedderOptions, GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'
import { mapState } from 'pinia'
import palettesAndClusts from '@/data/palette_clust.json'
import imgMetaData from '@/data/metadata_processed.json'
import imgEmbeddings from '@/data/image_embeddings.json'
import * as diff from "color-diff"
import { Vibrant } from "node-vibrant/browser"
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";

// console.log(BokehPass)

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)
const countsData = ref({})
const curEmbedding = ref({})
const distMapUse = ref({})
const userPaletteRgb = ref([])
const webcamEnabled = ref(false)
const paletteContainer = ref<HTMLDivElement | null>(null)
const allListingData = ref({})
const webcamButtonText = ref('ENABLE WEBCAM')
let imageSegmenter: ImageSegmenter
let imageEmbedder: ImageEmbedder
let gestureRecognizer: GestureRecognizer
let stream: MediaStream | null = null
let lastTriggerTime = 0;
const INTERVAL = 2000; // ms
let lastVideoTime = -1


const createGestureRecognizer = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      delegate: "GPU"
    },
    runningMode: 'VIDEO'
  });
  // demosSection.classList.remove("invisible");
};


const setupEmbedder = async () => {
  const fileset = await FilesetResolver.forVisionTasks(
    'node_modules/@mediapipe/tasks-vision/wasm'
  )

  imageEmbedder = await ImageEmbedder.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/1/mobilenet_v3_large.tflite',
        
      delegate: 'GPU' // or 'CPU' if needed
    },
    runningMode: 'IMAGE',
    quantize: false, // <-- string, not enum
    l2Normalize: true,
  })
  console.log('setup embedder')
}

const setupSegmenter = async () => {
  const fileset = await FilesetResolver.forVisionTasks('node_modules/@mediapipe/tasks-vision/wasm')
  imageSegmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
  })
}

const startWebcam = async () => {
  if (!videoRef.value || !canvasRef.value) return

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true })
    videoRef.value.srcObject = stream
    webcamEnabled.value = true
    webcamButtonText.value = 'DISABLE WEBCAM'

    videoRef.value.addEventListener('loadedmetadata', () => {
      resizeCanvas()
      videoRef.value?.play()
      requestAnimationFrame(predictWebcam)
    })
  } catch (e) {
    console.error('Webcam error:', e)
  }
}

const stopWebcam = () => {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  webcamEnabled.value = false
  webcamButtonText.value = 'ENABLE WEBCAM'
}

const toggleWebcam = async () => {
  if (webcamEnabled.value) {
    stopWebcam()
  } else {
    await setupSegmenter()
    await setupEmbedder()
    await startWebcam()
    await createGestureRecognizer()
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
  if (!webcamEnabled.value || !videoRef.value || !canvasRef.value || !maskCanvasRef.value || !imageSegmenter) return

  const video = videoRef.value
  const canvas = canvasRef.value
  const maskCanvas = maskCanvasRef.value
  const ctx = canvas.getContext('2d')
  const ctxMask = maskCanvas.getContext('2d')
  if (!ctx) return

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  try {
    const result: ImageSegmenterResult = await imageSegmenter.segmentForVideo(
      video,
      performance.now(),
    )

    const mask = result.categoryMask.getAsUint8Array()
    const { width, height } = result.categoryMask
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data

    // Clone masked imageData, used to create a second image without background
    // const clonedData = new Uint8ClampedArray(imageData.data); // deep copy
    // const clonedImageData = new ImageData(clonedData, imageData.width, imageData.height);

    const labels = imageSegmenter.getLabels?.() ?? []
    // console.log(labels)
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
    ctx.putImageData(imageData, 0, 0)
    ctx.save()

    let results = null
    let nowInMs = Date.now();
    if(gestureRecognizer != null) {
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        results = gestureRecognizer.recognizeForVideo(video, nowInMs);
      }
      // ctx.save();
      // ctx.clearRect(0, 0, canvas.width, canvas.height)
      const drawingUtils = new DrawingUtils(ctx)
      if (results.landmarks) {
        // let curClass = results?.gestures?.[0]?.categoryName ?? null;
        let curClass = results?.gestures?.[0]?.[0]?.categoryName ?? null;
        console.log(curClass)
        for (const landmarks of results.landmarks) {
          drawingUtils.drawConnectors(
            landmarks,
            GestureRecognizer.HAND_CONNECTIONS,
            {
              color: "#00FF00",
              lineWidth: 5
            }
          );
          drawingUtils.drawLandmarks(landmarks, {
            color: "#FF0000",
            lineWidth: 2
          });
        }
      }
      ctx.restore();
    }
    
    // if (results.gestures.length > 0) {
    //   gestureOutput.style.display = "block";
    //   gestureOutput.style.width = videoWidth;
    //   const categoryName = results.gestures[0][0].categoryName;
    //   const categoryScore = parseFloat(
    //     results.gestures[0][0].score * 100
    //   ).toFixed(2);
    //   const handedness = results.handednesses[0][0].displayName;
    //   gestureOutput.innerText = `GestureRecognizer: ${categoryName}\n Confidence: ${categoryScore} %\n Handedness: ${handedness}`;
    // } else {
    //   gestureOutput.style.display = "none";
    // }


    // Draw clothing masked image to canvas

    // Create <img> for color palette extraction if user has no palette and interval is met
    let [shouldTrigger, newTime] = shouldRun(600, lastTriggerTime);
    if (shouldTrigger) {
      lastTriggerTime = newTime;
      console.log('interval passed');
    }
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

      // if (paletteContainer.value) {
      //   paletteContainer.value.appendChild(img)
      // }
  
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
    const userVideoEmbedding = await imageEmbedder.embed(imageData)
    // const userVideoEmbeddingFloatArr = userVideoEmbedding.embeddings[0].floatEmbedding
    const userVideoEmbeddingFloatArr = userVideoEmbedding.embeddings[0].floatEmbedding
    // curEmbedding.value = quantizeEmbedding(userVideoEmbeddingFloatArr)
    // curEmbedding.value = userVideoEmbeddingFloatArr
    curEmbedding.value = userVideoEmbedding

    // Calculate cosine similarity
    const imgKeys = Object.keys(imgEmbeddings)

    if(shouldTrigger) {
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
        const listingCategories = ['tops', 'jacket-outerwear']
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
      // console.log('No palette: ', palCtGood, palCtBad)
      // console.log(cats)
      const getFinalImages = function(imageDict, firstSort,secondSort, nResults) {
        let filteredDistMap = imageDict.filter(item => item.similarityColor != null)
        let secondFilt = firstSort == 'cosine' ? 'color' : 'cosine'
        let firstSortDists = firstSort == 'cosine'
        ? filteredDistMap.sort((a, b) => a.similarityCosine - b.similarityCosine)
        : filteredDistMap.sort((a, b) => a.similarityColor - b.similarityColor)
        
        let limitedDists = filteredDistMap.slice(0, 50)
        // let limitedSort = firstFilt == 'cosine'
        // ? limitedDists.sort((a, b) => a.similarityColor - b.similarityColor)
        // : limitedDists.sort((a, b) => a.similarityCosine - b.similarityCosine)
  
        return limitedDists.slice(0, nResults)
      }
  
      let firstFilt = 'cosine'
      let secondFilt = firstFilt == 'cosine' ? 'color' : 'cosine'
      let finalImages = getFinalImages(distMap, firstFilt, secondFilt, 10)
      distMapUse.value = finalImages
  
  
      result.categoryMask.close();
      
    }

    try {
      // console.log(distMapUse.value[0].palette[0]);
    } catch (e) {

    }
    requestAnimationFrame(predictWebcam)
  } catch (e) {
    console.warn('predictWebcam() failed: ', e)
  }
}


onMounted(() => {
  // buildDataSet(palettesAndClusts, imgMetaData)
})

onBeforeUnmount(() => {
  stopWebcam()
})
</script>

<template>
  <div class="app">
    <h1 style="color: white">Real-time Image Segmentation and Similarity</h1>

    <button @click="toggleWebcam">
      {{ webcamButtonText }}
    </button>

    <div class="webcam-container">
      <video ref="videoRef" autoplay muted playsinline></video>
      <canvas ref="canvasRef"></canvas>
      <canvas ref="maskCanvasRef"></canvas>
    </div>
    <div>
      <!-- <span>{{ curEmbedding }}</span> -->
    </div>
    <div class="palette-row">
      <div
        v-for="(rgb, index) in userPaletteRgb"
        :key="index"
        class="color-block"
        :style="{ backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` }"
      ></div>
    </div>
    <div ref="paletteContainer"></div>
    <div id="photoDiv" style="display: flex; margin-top: 5px">
      <div v-for="item in distMapUse" :key="item.key" style="margin-bottom: 20px">
        <img
          :src="`/src/assets/images/${item.key}`"
          :alt="item.key"
          style="width: 150px; margin: 5px"
        />
        <p style="margin-left: 10px;">
          color Similarity: {{ Math.round(item.similarityColor, 2) }}
        </p>

         <p style="margin-left: 10px;">
          cosine Similarity: {{ Math.round(item.similarityCosine, 2) }}
        </p>

        <div
          v-if="item.palette && Array.isArray(item.palette)"
          style="display: flex; margin-top: 5px"
        >
          <div
            v-for="(color, idx) in item.palette"
            :key="idx"
            :style="{
              width: '25px',
              height: '25px',
              backgroundColor: `rgb(${color[0]*255}, ${color[1]*255}, ${color[2]*255})`,
              border: '1px solid #000',
              marginRight: '4px'
            }"
          ></div>
        </div>
      </div>
    </div>

    <!-- <div id="photoDiv">
      <img
        v-for="item in distMapUse"
        :key="item.key"
        :src="`/src/assets/images/${item.key}`"
        :alt="item.key"
        style="width: 150px; margin: 5px"
      />
  </div> -->
    <div>
      <ul>
        <li v-for="(count, label) in countsData" :key="label">Label {{ label }}: {{ count }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.webcam-container {
  position: relative;
  width: 480px;              /* or any size you want */
  aspect-ratio: 1 / 1;       /* Make it square */
  margin: 0 auto;
  overflow: hidden;          /* Just in case */
  background: black;
}

video,
canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;         /* Crops the video to fill the square */
  top: 0;
  left: 0;
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
</style>