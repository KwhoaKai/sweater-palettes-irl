import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

/** 
Store for IntroView




**/
export const useIntroStore = defineStore('introView', () => {
    const userColorPalette = ref(null)
    // const image

  const count = ref(0)
  const doubleCount = computed(() => count.value * 2)
  function increment() {
    count.value++
  }

  return { count, doubleCount, increment }
})
