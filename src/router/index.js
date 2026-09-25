import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresGuest: true }
    },
    {
      path: '/',
      redirect: '/dashboard/perencanaan'
    },
    {
      path: '/dashboard',
      component: () => import('../layouts/DashboardLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: 'perencanaan',
          name: 'Perencanaan',
          component: () => import('../views/BidangView.vue'),
          props: { slug: 'perencanaan' }
        },
        {
          path: 'palev',
          name: 'Palev',
          component: () => import('../views/BidangView.vue'),
          props: { slug: 'palev' }
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('../views/AdminView.vue'),
          props: { initialTab: 'users' },
          meta: { requiresSuperAdmin: true }
        },
        {
          path: 'admin',
          redirect: '/dashboard/users'
        },
        {
          path: 'logs',
          name: 'Logs',
          component: () => import('../views/LogsView.vue'),
          meta: { requiresSuperAdmin: true }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard/perencanaan'
    }
  ]
})

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // Init auth dari localStorage jika belum
  if (!authStore.user && authStore.token) {
    await authStore.init()
  }

  if (to.meta.requiresAuth && !authStore.isLoggedIn) {
    return next('/login')
  }

  if (to.meta.requiresGuest && authStore.isLoggedIn) {
    return next('/dashboard/perencanaan')
  }

  if (to.meta.requiresSuperAdmin && !authStore.isSuperAdmin) {
    return next('/dashboard/perencanaan')
  }

  next()
})

export default router
