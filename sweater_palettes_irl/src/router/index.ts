import { createRouter, createWebHistory } from 'vue-router'
import IntroView from '../views/IntroView.vue'
// import SceneOne from '../views/SceneOne.vue'
// import SceneTwo from '../views/SceneTwo.vue'
// import SceneThree from '../views/SceneThree.vue'

// const routes = [
//   { path: '/', redirect: '/scene1' },
//   { path: '/intro', component: SceneOne },
//   { path: '/selection', component: SceneTwo },
//   { path: '/incluster', component: SceneThree },
//   { path: '/clusters', component: SceneFour }
// ]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'intro',
      component: IntroView,
    },
    {
      path: '/selection',
      name: 'selectionScreen',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/SelectionView.vue'),
    },
  ],
})

export default router
