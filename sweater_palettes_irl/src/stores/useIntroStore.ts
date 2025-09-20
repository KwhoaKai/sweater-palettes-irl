import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useIntroStore = defineStore('intro', () => {
  // Reactive state that needs to be shared across routes
  const stream = ref(null)
  const camEnabled = ref(false)
  const searchResults = ref([])
  const clusterId = ref(null)
  const topImage = ref(null)
  const curCamFrameEmbedding = ref({})
  const finalUserPalette = ref([])

  // Non-reactive storage for MediaPipe tasks
  // These are stored as plain properties, not reactive refs
  let _gestureRecognizer = null
  let _imageEmbedder = null
  let _imageSegmenter = null

  async function start() {
    if (!stream.value) {
      stream.value = await navigator.mediaDevices.getUserMedia({ video: true })
      camEnabled.value = true
    }
    return stream.value
  }

  function stop() { 
    if (stream.value) {
      stream.value.getTracks().forEach(track => track.stop())
      stream.value = null
      camEnabled.value = false
    }
  }

  // Getters and setters for MediaPipe tasks
  function setGestureRecognizer(recognizer) {
    _gestureRecognizer = recognizer
  }

  function getGestureRecognizer() {
    return _gestureRecognizer
  }

  function setImageEmbedder(embedder) {
    _imageEmbedder = embedder
  }

  function getImageEmbedder() {
    return _imageEmbedder
  }

  function setImageSegmenter(segmenter) {
    _imageSegmenter = segmenter
  }

  function getImageSegmenter() {
    return _imageSegmenter
  }

  // Check if tasks are initialized
  function areTasksInitialized() {
    return _gestureRecognizer !== null && _imageEmbedder !== null && _imageSegmenter !== null
  }

  // Clean up tasks when needed
  function cleanupTasks() {
    _gestureRecognizer = null
    _imageEmbedder = null
    _imageSegmenter = null
  }

  return { 
    stream, 
    camEnabled, 
    curCamFrameEmbedding,
    finalUserPalette,
    searchResults, 
    clusterId, 
    topImage,
    start, 
    stop, 
    setGestureRecognizer,
    getGestureRecognizer,
    setImageEmbedder,
    getImageEmbedder,
    setImageSegmenter,
    getImageSegmenter,
    areTasksInitialized,
    cleanupTasks
  }
})