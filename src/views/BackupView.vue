<template>
  <div class="backup-view">
    <div class="page-header">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
        <div>
          <h1 class="page-title">🗄️ Riwayat Backup Sistem</h1>
          <p class="caption">Lihat isi backup, unduh arsip utuh, dan pulihkan (restore) file/folder sesuai bidang Anda</p>
        </div>
        <div v-if="authStore.isSuperAdmin" style="display:flex; gap:0.5rem;">
          <button class="btn btn-primary btn-sm" @click="createBackupNow" :disabled="creatingBackup">
            <span v-if="creatingBackup" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
            💾 Backup Sekarang
          </button>
        </div>
      </div>
    </div>

    <!-- Super Admin Settings Panel -->
    <div v-if="authStore.isSuperAdmin" class="settings-card">
      <div class="settings-header">
        <h3>⚙️ Pengaturan Jadwal Backup & Retensi (Super Admin)</h3>
      </div>
      <form @submit.prevent="saveSettings" class="settings-grid">
        <div class="form-group">
          <label>Jadwal Backup Otomatis Harian</label>
          <input type="time" v-model="settingsForm.backup_time" required />
          <span class="form-hint">Default 01:30 WIB di luar jam kerja</span>
        </div>
        <div class="form-group">
          <label>Retensi Harian (Hari)</label>
          <input type="number" v-model="settingsForm.backup_retention_days" min="1" max="90" required />
          <span class="form-hint">Jumlah backup harian yang disimpan (default 7)</span>
        </div>
        <div class="form-group">
          <label>Retensi Mingguan (Pekan)</label>
          <input type="number" v-model="settingsForm.backup_retention_weeks" min="1" max="52" required />
          <span class="form-hint">Jumlah backup mingguan yang disimpan (default 4)</span>
        </div>
        <div style="display:flex;align-items:flex-end;">
          <button type="submit" class="btn btn-outline" :disabled="savingSettings" style="height:38px;">
            {{ savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Daftar Backup Table -->
    <div class="results-card">
      <div class="results-header">
        <h2>Daftar Arsip Backup</h2>
        <button class="btn btn-outline btn-xs" @click="fetchBackups" :disabled="loading">🔄 Segarkan</button>
      </div>

      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>Memuat riwayat backup...</p>
      </div>

      <div v-else-if="backups.length === 0" class="empty-state">
        <p>Belum ada file backup tersimpan.</p>
      </div>

      <div v-else class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nama Backup</th>
              <th>Ukuran</th>
              <th>Tipe</th>
              <th>Dibuat Oleh</th>
              <th>Waktu Pembuatan</th>
              <th style="text-align:right;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in backups" :key="b.id">
              <td>
                <strong>📦 {{ b.filename }}</strong>
                <div class="caption">SHA-256: <code>{{ b.checksum ? b.checksum.slice(0, 12) + '...' : '—' }}</code></div>
              </td>
              <td>{{ formatSize(b.size) }}</td>
              <td>
                <span class="badge" :class="b.type === 'daily' ? 'badge-admin' : 'badge-super'">
                  {{ b.type === 'daily' ? 'Harian' : (b.type === 'safety_pre_restore' ? 'Safety Pre-Restore' : 'Manual') }}
                </span>
              </td>
              <td class="caption">{{ b.created_by }}</td>
              <td class="caption">{{ formatDateTime(b.created_at) }}</td>
              <td style="text-align:right;white-space:nowrap;">
                <!-- Tombol Lihat Isi Tree View (Semua Admin) -->
                <button class="btn btn-outline btn-xs" @click="openTreeModal(b)">
                  👁️ Lihat Isi
                </button>

                <!-- Tombol Unduh Utuh (Super Admin) -->
                <button
                  v-if="authStore.isSuperAdmin"
                  class="btn btn-primary btn-xs"
                  style="margin-left:4px;"
                  @click="downloadBackup(b)"
                >
                  Unduh ↓
                </button>

                <!-- Tombol Restore Penuh (Super Admin Only) -->
                <button
                  v-if="authStore.isSuperAdmin"
                  class="btn btn-danger btn-xs"
                  style="margin-left:4px;"
                  @click="confirmFullRestore(b)"
                >
                  Restore Penuh
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- MODAL: Tree View & Restore Parsial -->
    <Teleport to="body">
      <div v-if="activeBackupTree" class="modal-overlay" @click.self="activeBackupTree = null">
        <div class="modal-box modal-box--large">
          <div class="modal-header">
            <div>
              <h3>Isi File Arsip: {{ activeBackupTree.filename }}</h3>
              <div class="caption">Pilih file atau folder untuk dipulihkan (restore parsial) ke sistem aktif</div>
            </div>
            <button class="btn-icon" @click="activeBackupTree = null">✕</button>
          </div>

          <div v-if="loadingTree" class="empty-state">
            <div class="spinner"></div>
            <p>Membaca struktur direktori backup...</p>
          </div>

          <div v-else class="tree-content">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
              <span class="caption">{{ treeFiles.length }} file terdaftar di dalam backup</span>
              <label class="checkbox-label">
                <input type="checkbox" v-model="restoreOverwrite" />
                <span style="font-size:0.8rem;">Timpa file jika sudah ada (uncheck = simpan salinan)</span>
              </label>
            </div>

            <div class="tree-table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:30px;">
                      <input type="checkbox" :checked="isAllTreeSelected" @change="toggleSelectAllTree" />
                    </th>
                    <th>Jalur File (Path)</th>
                    <th>Ukuran</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="file in treeFiles" :key="file.path">
                    <td>
                      <input type="checkbox" :value="file.path" v-model="selectedTreePaths" />
                    </td>
                    <td>
                      <code>{{ file.path }}</code>
                    </td>
                    <td>{{ formatSize(file.size) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline" @click="activeBackupTree = null">Tutup</button>
            <button
              class="btn btn-primary"
              :disabled="selectedTreePaths.length === 0 || restoringPartial"
              @click="submitPartialRestore"
            >
              <span v-if="restoringPartial" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
              Pulihkan {{ selectedTreePaths.length }} Item Terpilih
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast Notification -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const API = '/api'

const backups = ref([])
const loading = ref(false)
const creatingBackup = ref(false)
const toasts = ref([])

// Settings
const settingsForm = ref({
  backup_time: '01:30',
  backup_retention_days: 7,
  backup_retention_weeks: 4,
})
const savingSettings = ref(false)

// Tree & Partial Restore
const activeBackupTree = ref(null)
const treeFiles = ref([])
const loadingTree = ref(false)
const selectedTreePaths = ref([])
const restoreOverwrite = ref(false)
const restoringPartial = ref(false)

const isAllTreeSelected = computed(() => {
  if (treeFiles.value.length === 0) return false
  return treeFiles.value.every(f => selectedTreePaths.value.includes(f.path))
})

function toggleSelectAllTree() {
  if (isAllTreeSelected.value) {
    selectedTreePaths.value = []
  } else {
    selectedTreePaths.value = treeFiles.value.map(f => f.path)
  }
}

async function fetchBackups() {
  loading.value = true
  try {
    const res = await axios.get(`${API}/backups`)
    backups.value = res.data.backups || []
  } catch (err) {
    showToast('Gagal memuat riwayat backup.', 'error')
  } finally {
    loading.value = false
  }
}

async function fetchSettings() {
  if (!authStore.isSuperAdmin) return
  try {
    const res = await axios.get(`${API}/backups/settings`)
    if (res.data.settings) {
      settingsForm.value.backup_time = res.data.settings.backup_time || '01:30'
      settingsForm.value.backup_retention_days = parseInt(res.data.settings.backup_retention_days || '7', 10)
      settingsForm.value.backup_retention_weeks = parseInt(res.data.settings.backup_retention_weeks || '4', 10)
    }
  } catch (_) {}
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await axios.post(`${API}/backups/settings`, settingsForm.value)
    showToast('Pengaturan jadwal dan retensi berhasil disimpan.', 'success')
  } catch (err) {
    showToast('Gagal menyimpan pengaturan.', 'error')
  } finally {
    savingSettings.value = false
  }
}

async function createBackupNow() {
  creatingBackup.value = true
  showToast('Membuat arsip backup sistem... Mohon tunggu.', 'info')
  try {
    await axios.post(`${API}/backups/create`)
    showToast('Backup berhasil dibuat!', 'success')
    await fetchBackups()
  } catch (err) {
    showToast('Gagal membuat backup: ' + (err.response?.data?.error || err.message), 'error')
  } finally {
    creatingBackup.value = false
  }
}

function downloadBackup(b) {
  window.open(`${API}/backups/${b.id}/download`, '_blank')
}

async function openTreeModal(b) {
  activeBackupTree.value = b
  treeFiles.value = []
  selectedTreePaths.value = []
  loadingTree.value = true
  try {
    const res = await axios.get(`${API}/backups/${b.id}/tree`)
    treeFiles.value = res.data.files || []
  } catch (err) {
    showToast('Gagal membaca isi backup.', 'error')
    activeBackupTree.value = null
  } finally {
    loadingTree.value = false
  }
}

async function submitPartialRestore() {
  if (selectedTreePaths.value.length === 0) return
  restoringPartial.value = true
  try {
    const res = await axios.post(`${API}/backups/${activeBackupTree.value.id}/restore-partial`, {
      file_paths: selectedTreePaths.value,
      overwrite: restoreOverwrite.value
    })
    showToast(res.data.message || 'Restorasi sebagian berhasil!', 'success')
    activeBackupTree.value = null
  } catch (err) {
    showToast('Gagal memulihkan file: ' + (err.response?.data?.error || err.message), 'error')
  } finally {
    restoringPartial.value = false
  }
}

async function confirmFullRestore(b) {
  const c1 = confirm(`PERINGATAN: Anda akan melakukan Restore Sistem Penuh dari "${b.filename}". Sebelum proses berjalan, sistem akan otomatis membuat backup pengaman. Lanjutkan?`)
  if (!c1) return
  const c2 = confirm(`Konfirmasi ganda: Apakah Anda benar-benar yakin ingin memulihkan database dan file sistem ke kondisi backup ini?`)
  if (!c2) return

  showToast('Menjalankan restore penuh dengan backup pengaman...', 'info')
  try {
    const res = await axios.post(`${API}/backups/${b.id}/restore-full`)
    showToast(res.data.message || 'Restore penuh selesai!', 'success')
    await fetchBackups()
  } catch (err) {
    showToast('Gagal restore penuh: ' + (err.response?.data?.error || err.message), 'error')
  }
}

function formatSize(bytes) {
  if (!bytes) return '—'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function showToast(message, type = 'success') {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3200)
}

onMounted(() => {
  fetchBackups()
  fetchSettings()
})
</script>

<style scoped>
.backup-view {
  padding: 1.5rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}
.page-header {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.8rem;
}
.page-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.settings-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
}
.settings-header h3 {
  font-size: 0.95rem;
  margin-bottom: 0.8rem;
  color: var(--color-text-primary);
}
.settings-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2rem;
}
.results-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
}
.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.results-header h2 {
  font-size: 1.05rem;
  font-weight: 600;
}
.table-responsive {
  overflow-x: auto;
}
.tree-table-wrap {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}
</style>
