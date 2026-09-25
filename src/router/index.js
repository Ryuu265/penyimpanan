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
      redirect: '/dashboard'
    },
    {
      path: '/dashboard',
      component: () => import('../layouts/DashboardLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        // ─── Route baru: modul berdasarkan bidangId ───────────────────────
        {
          path: 'modul/:bidangId',
          name: 'Modul',
          component: () => import('../views/BidangView.vue'),
          props: true
        },
        // ─── Legacy routes untuk backward compat ─────────────────────────
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
        // ─── Admin & Logs ─────────────────────────────────────────────────
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
        },
        // ─── Default: redirect ke halaman utama ───────────────────────────
        {
          path: '',
          redirect: () => {
            // Akan di-handle oleh DashboardLayout yang navigasi ke modul pertama
            return '/dashboard/perencanaan'
          }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard'
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
    return next('/dashboard')
  }

  if (to.meta.requiresSuperAdmin && !authStore.isSuperAdmin) {
    return next('/dashboard')
  }

  next()
})

export default router
