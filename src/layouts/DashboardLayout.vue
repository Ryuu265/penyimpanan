<template>
  <div class="dashboard-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
          <rect width="36" height="36" rx="9" fill="var(--color-primary)"/>
          <path d="M10 12h16M10 18h10M10 24h12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <div>
          <div class="sidebar-logo-title">Bapperida</div>
          <div class="sidebar-logo-sub">Pusat Data</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <!-- ─── Tahun Anggaran ─────────────────────────────────────── -->
        <div class="nav-section-label">TAHUN ANGGARAN</div>

        <div v-if="appStore.loadingTahun" class="nav-loading">Memuat tahun...</div>

        <div v-else class="year-list">
          <button
            v-for="t in appStore.tahunList"
            :key="t.id"
            class="year-btn"
            :class="{ 'year-btn--active': appStore.selectedTahunId === t.id }"
            @click="selectTahun(t.id)"
          >
            <span class="year-btn-icon">📅</span>
            <span class="year-btn-name">{{ t.nama }}</span>
            <span class="year-btn-label">{{ t.label }}</span>
          </button>
          <div v-if="appStore.tahunList.length === 0" class="nav-empty">
            Belum ada tahun.<br>Tambah tahun untuk mulai.
          </div>
        </div>

        <!-- Tombol + Tambah Tahun (hanya superadmin) -->
        <button
          v-if="authStore.isSuperAdmin"
          class="btn-nav-add"
          @click="openTahunModal()"
          title="Tambah Tahun Anggaran Baru"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Tambah Tahun
        </button>

        <!-- ─── Modul ───────────────────────────────────────────────── -->
        <div class="nav-section-label" style="margin-top:1.1rem;">MODUL</div>

        <!-- Modul untuk tahun yang dipilih -->
        <div v-if="appStore.selectedTahunId">
          <div v-if="appStore.loadingModul" class="nav-loading">Memuat modul...</div>
          <template v-else>
            <router-link
              v-for="modul in appStore.modulList"
              :key="modul.id"
              :to="`/dashboard/modul/${modul.id}`"
              class="nav-item"
              active-class="nav-item--active"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span class="nav-item-name">{{ modul.nama_bidang }}</span>
            </router-link>
            <div v-if="appStore.modulList.length === 0" class="nav-empty">
              Belum ada modul untuk tahun ini.
            </div>
          </template>

          <!-- Tombol + Tambah Modul (hanya superadmin) -->
          <button
            v-if="authStore.isSuperAdmin"
            class="btn-nav-add"
            @click="openModulModal()"
            title="Tambah Modul Baru"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Tambah Modul
          </button>
        </div>
        <div v-else class="nav-empty">Pilih tahun untuk melihat modul.</div>

        <!-- ─── Administrasi (Super Admin Only) ────────────────────── -->
        <template v-if="authStore.isSuperAdmin">
          <div class="nav-section-label" style="margin-top:1.1rem;">ADMINISTRASI</div>
          <router-link to="/dashboard/users" class="nav-item" active-class="nav-item--active">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Manajemen User
          </router-link>
          <router-link to="/dashboard/logs" class="nav-item" active-class="nav-item--active">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Log Aktivitas
          </router-link>
        </template>
      </nav>

      <!-- User Profile -->
      <div class="sidebar-user">
        <div class="sidebar-user-info">
          <div class="sidebar-avatar">{{ userInitials }}</div>
          <div class="sidebar-user-details">
            <div class="sidebar-user-name">{{ authStore.user?.nama }}</div>
            <div>
              <span class="badge" :class="roleBadgeClass">{{ roleLabel }}</span>
            </div>
          </div>
        </div>
        <button class="btn-icon" @click="handleLogout" title="Keluar">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <router-view />
    </main>

    <!-- ─── Modal: Tambah / Edit Tahun ─────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showTahunModal" class="modal-overlay" @click.self="showTahunModal = false">
        <div class="modal-box modal-box--sm">
          <div class="modal-header">
            <h3>{{ editingTahun ? 'Edit Tahun' : '+ Tambah Tahun Anggaran' }}</h3>
            <button class="btn-icon" @click="showTahunModal = false">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <form @submit.prevent="submitTahun">
            <div class="form-group">
              <label>Tahun <span style="color:var(--color-danger)">*</span></label>
              <input
                v-model="tahunForm.nama"
                placeholder="contoh: 2026"
                pattern="\d{4}"
                maxlength="4"
                required
                :readonly="!!editingTahun"
              />
              <span class="form-hint">Format 4 digit angka</span>
            </div>
            <div class="form-group">
              <label>Label Tampilan</label>
              <input v-model="tahunForm.label" placeholder="contoh: Tahun Anggaran 2026" />
              <span class="form-hint">Opsional. Kosongkan untuk otomatis.</span>
            </div>
            <div v-if="tahunFormError" class="error-alert">{{ tahunFormError }}</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline" @click="showTahunModal = false">Batal</button>
              <button type="submit" class="btn btn-primary" :disabled="tahunFormLoading">
                <span v-if="tahunFormLoading" class="spinner" style="width:13px;height:13px;border-width:2px;"></span>
                {{ editingTahun ? 'Simpan' : 'Tambah Tahun' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- ─── Modal: Tambah Modul ────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showModulModal" class="modal-overlay" @click.self="showModulModal = false">
        <div class="modal-box modal-box--sm">
          <div class="modal-header">
            <h3>+ Tambah Modul Baru</h3>
            <button class="btn-icon" @click="showModulModal = false">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <form @submit.prevent="submitModul">
            <div class="info-badge" v-if="appStore.selectedTahun">
              📅 Tahun: <strong>{{ appStore.selectedTahun.nama }}</strong>
            </div>
            <div class="form-group" style="margin-top:0.8rem;">
              <label>Nama Modul <span style="color:var(--color-danger)">*</span></label>
              <input v-model="modulForm.nama_bidang" placeholder="contoh: Infrastruktur, Kesehatan, dll." required />
            </div>
            <div v-if="modulFormError" class="error-alert">{{ modulFormError }}</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline" @click="showModulModal = false">Batal</button>
              <button type="submit" class="btn btn-primary" :disabled="modulFormLoading">
                <span v-if="modulFormLoading" class="spinner" style="width:13px;height:13px;border-width:2px;"></span>
                Tambah Modul
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <div class="layout-toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'

const authStore = useAuthStore()
const appStore = useAppStore()
const router = useRouter()

const API = '/api'

// ─── User info ─────────────────────────────────────────────────────────────
const userInitials = computed(() => {
  const nama = authStore.user?.nama || ''
  return nama.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
})
const roleLabel = computed(() => {
  const map = { SUPER_ADMIN: 'Super Admin', ADMIN_BIDANG: 'Admin Bidang', VIEWER: 'Viewer' }
  return map[authStore.user?.role] || authStore.user?.role
})
const roleBadgeClass = computed(() => {
  const map = { SUPER_ADMIN: 'badge-super', ADMIN_BIDANG: 'badge-admin', VIEWER: 'badge-viewer' }
  return map[authStore.user?.role] || 'badge-viewer'
})

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

// ─── Year selector ─────────────────────────────────────────────────────────
async function selectTahun(tahunId) {
  await appStore.setSelectedTahun(tahunId)
  // Navigasi ke modul pertama di tahun yang baru dipilih
  if (appStore.modulList.length > 0) {
    router.push(`/dashboard/modul/${appStore.modulList[0].id}`)
  }
}

// ─── Modal: Tahun ──────────────────────────────────────────────────────────
const showTahunModal = ref(false)
const editingTahun = ref(null)
const tahunForm = ref({ nama: '', label: '' })
const tahunFormLoading = ref(false)
const tahunFormError = ref('')
const toasts = ref([])

function openTahunModal(t = null) {
  editingTahun.value = t
  tahunForm.value = { nama: t?.nama || '', label: t?.label || '' }
  tahunFormError.value = ''
  showTahunModal.value = true
}

async function submitTahun() {
  tahunFormError.value = ''
  tahunFormLoading.value = true
  try {
    if (editingTahun.value) {
      await axios.put(`${API}/tahun/${editingTahun.value.id}`, tahunForm.value)
      showToast('Tahun berhasil diperbarui.', 'success')
    } else {
      await axios.post(`${API}/tahun`, tahunForm.value)
      showToast(`Tahun ${tahunForm.value.nama} berhasil ditambahkan!`, 'success')
    }
    showTahunModal.value = false
    await appStore.fetchTahun()
  } catch (e) {
    tahunFormError.value = e.response?.data?.error || 'Gagal menyimpan tahun.'
  } finally {
    tahunFormLoading.value = false
  }
}

// ─── Modal: Modul ──────────────────────────────────────────────────────────
const showModulModal = ref(false)
const modulForm = ref({ nama_bidang: '' })
const modulFormLoading = ref(false)
const modulFormError = ref('')

function openModulModal() {
  modulForm.value = { nama_bidang: '' }
  modulFormError.value = ''
  showModulModal.value = true
}

async function submitModul() {
  modulFormError.value = ''
  modulFormLoading.value = true
  try {
    const res = await axios.post(`${API}/bidang`, {
      nama_bidang: modulForm.value.nama_bidang,
      tahun_id: appStore.selectedTahunId,
    })
    showToast(`Modul "${modulForm.value.nama_bidang}" berhasil ditambahkan!`, 'success')
    showModulModal.value = false
    await appStore.fetchModul()
    // Navigasi ke modul baru
    if (res.data.id) {
      router.push(`/dashboard/modul/${res.data.id}`)
    }
  } catch (e) {
    modulFormError.value = e.response?.data?.error || 'Gagal menambah modul.'
  } finally {
    modulFormLoading.value = false
  }
}

// ─── Toast helper ──────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3200)
}

// ─── Init ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  await appStore.fetchTahun()
  // Jika tidak ada route yang aktif (hanya /dashboard), arahkan ke modul pertama
  if (appStore.modulList.length > 0 && router.currentRoute.value.path === '/dashboard') {
    router.push(`/dashboard/modul/${appStore.modulList[0].id}`)
  }
})
</script>

<style scoped>
.dashboard-layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

/* ─── Sidebar ─────────────────────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-width);
  min-height: 100vh;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
  box-shadow: var(--shadow-sidebar);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1.1rem 1rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.sidebar-logo-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--color-text-primary);
  line-height: 1.2;
}
.sidebar-logo-sub {
  font-size: 0.7rem;
  color: var(--color-text-caption);
}

.sidebar-nav {
  flex: 1;
  padding: 0.85rem 0.6rem 0.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-section-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-caption);
  letter-spacing: 0.08em;
  padding: 0.3rem 0.5rem 0.2rem;
  text-transform: uppercase;
  flex-shrink: 0;
}

.nav-loading {
  font-size: 0.78rem;
  color: var(--color-text-caption);
  padding: 0.4rem 0.5rem;
  font-style: italic;
}

.nav-empty {
  font-size: 0.76rem;
  color: var(--color-text-caption);
  padding: 0.4rem 0.6rem;
  line-height: 1.45;
}

/* ─── Year buttons ────────────────────────────────────────────────── */
.year-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 2px;
}

.year-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--transition), color var(--transition);
  font-family: var(--font-family);
  position: relative;
}
.year-btn:hover {
  background: var(--color-bg);
}
.year-btn--active {
  background: var(--color-primary-light) !important;
}
.year-btn-icon {
  font-size: 0.95rem;
  flex-shrink: 0;
}
.year-btn-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}
.year-btn--active .year-btn-name {
  color: var(--color-primary-dark);
}
.year-btn-label {
  font-size: 0.68rem;
  color: var(--color-text-caption);
  display: block;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
  margin-top: 1px;
}

/* ─── Add buttons ─────────────────────────────────────────────────── */
.btn-nav-add {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.38rem 0.65rem;
  border-radius: var(--radius-md);
  border: 1.5px dashed var(--color-border);
  color: var(--color-text-caption);
  font-size: 0.76rem;
  font-weight: 600;
  background: transparent;
  cursor: pointer;
  width: 100%;
  margin-top: 3px;
  transition: all var(--transition);
  font-family: var(--font-family);
}
.btn-nav-add:hover {
  border-color: var(--color-primary);
  color: var(--color-primary-dark);
  background: var(--color-primary-light);
}

/* ─── Module nav items ────────────────────────────────────────────── */
.nav-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: background var(--transition), color var(--transition);
}
.nav-item:hover {
  background: var(--color-bg);
  color: var(--color-text-primary);
}
.nav-item--active {
  background: var(--color-primary-light) !important;
  color: var(--color-primary-dark) !important;
  font-weight: 600;
}
.nav-item--active svg { color: var(--color-primary); }
.nav-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── User profile ────────────────────────────────────────────────── */
.sidebar-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 0.75rem;
  border-top: 1px solid var(--color-border);
  gap: 0.5rem;
  flex-shrink: 0;
}
.sidebar-user-info {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  flex: 1;
}
.sidebar-avatar {
  width: 32px;
  height: 32px;
  background: var(--color-primary-light);
  color: var(--color-primary-dark);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 700;
  flex-shrink: 0;
}
.sidebar-user-details { min-width: 0; }
.sidebar-user-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Main content ────────────────────────────────────────────────── */
.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  min-height: 100vh;
  padding: 0;
  overflow: auto;
}

/* ─── Modal ───────────────────────────────────────────────────────── */
.modal-box--sm {
  max-width: 420px;
}
.info-badge {
  background: var(--color-primary-light);
  color: var(--color-primary-dark);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.75rem;
  font-size: 0.82rem;
}
.form-hint {
  font-size: 0.72rem;
  color: var(--color-text-caption);
  margin-top: 3px;
  display: block;
}

/* ─── Toast ───────────────────────────────────────────────────────── */
.layout-toast-container {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}
</style>
