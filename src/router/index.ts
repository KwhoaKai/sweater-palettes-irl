import { createRouter, createWebHistory } from 'vue-router'
import IntroView from '../views/IntroView.vue'
import SelectionView from '../views/SelectionView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'introPage',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/IntroView.vue'),
      // Below is the old way of declaring routes 
      // component: IntroView 
    },
    {
      path: '/selection',
      name: 'selectionPage',
      component: () => import('../views/SelectionView.vue'),
    },
  ],
})

export default router
