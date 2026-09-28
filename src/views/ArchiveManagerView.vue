<template>
  <div class="archive-manager-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">📦 Manajemen Arsip & Kapasitas Disk</h1>
        <p class="caption">Kontrol Lifecycle Hot/Cold Storage Lokal, kapasitas disk, dan aturan pengarsipan otomatis (Super Admin Only)</p>
      </div>
    </div>

    <!-- Disk Usage Capacity Cards -->
    <div class="disk-grid">
      <!-- Hot Storage Card -->
      <div class="disk-card">
        <div class="dc-title">
          <span>🔥 Hot Storage (File Aktif)</span>
          <span class="badge badge-hot">Aktif</span>
        </div>
        <div class="dc-metric">{{ formatSize(diskUsage.hot?.bytes) }}</div>
        <div class="caption">{{ diskUsage.hot?.files || 0 }} file fisik di server</div>
        <div class="dc-path"><code>{{ diskUsage.hot?.path }}</code></div>
      </div>

      <!-- Cold Archive Card -->
      <div class="disk-card">
        <div class="dc-title">
          <span>❄️ Cold Storage (Arsip Terkompresi)</span>
          <span class="badge badge-cold">Arsip</span>
        </div>
        <div class="dc-metric">{{ formatSize(diskUsage.archive?.bytes) }}</div>
        <div class="caption">{{ diskUsage.archive?.files || 0 }} paket zip di server</div>
        <div class="dc-path"><code>{{ diskUsage.archive?.path }}</code></div>
      </div>

      <!-- Backup Card -->
      <div class="disk-card">
        <div class="dc-title">
          <span>🗄️ Backup Storage</span>
          <span class="badge badge-admin">Cadangan</span>
        </div>
        <div class="dc-metric">{{ formatSize(diskUsage.backup?.bytes) }}</div>
        <div class="caption">{{ diskUsage.backup?.files || 0 }} file backup utuh</div>
        <div class="dc-path"><code>{{ diskUsage.backup?.path }}</code></div>
      </div>
    </div>

    <!-- Lifecycle Rule Configuration Card -->
    <div class="card section-card">
      <div class="sc-header">
        <div>
          <h2>⚙️ Aturan Lifecycle Arsip Otomatis (Lifecycle Rule)</h2>
          <p class="caption">File lokal di Hot Storage yang melewati batas usia hari akan otomatis dikompres ke paket zip, diverifikasi checksum SHA-256, lalu dipindah ke Cold Storage.</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="runLifecycleNow" :disabled="runningLifecycle">
          <span v-if="runningLifecycle" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
          ⚡ Jalankan Lifecycle Sekarang
        </button>
      </div>

      <form @submit.prevent="saveLifecycleSettings" class="lifecycle-form">
        <div class="form-row">
          <div class="form-group">
            <label>Batas Umur File (Hari)</label>
            <input type="number" v-model="form.archive_lifecycle_days" min="1" max="365" required />
            <span class="form-hint">Default 30 hari. File lebih baru dari ini tetap Hot.</span>
          </div>

          <div class="form-group">
            <label>Jadwal Eksekusi Otomatis (WIB)</label>
            <input type="time" v-model="form.archive_lifecycle_time" required />
            <span class="form-hint">Default 01:00 WIB di luar jam kerja.</span>
          </div>

          <div class="form-group">
            <label>Status Lifecycle Otomatis</label>
            <select v-model="form.archive_lifecycle_enabled">
              <option value="1">Aktif (Berjalan setiap 24 jam)</option>
              <option value="0">Nonaktif</option>
            </select>
          </div>
        </div>

        <div style="margin-top:1rem;">
          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? 'Menyimpan...' : '💾 Simpan Konfigurasi Lifecycle' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Arsip Seluruh Tahun Anggaran -->
    <div class="card section-card">
      <div class="sc-header">
        <div>
          <h2>📅 Arsip Seluruh Tahun Anggaran</h2>
          <p class="caption">Pindahkan seluruh file aktif untuk tahun anggaran yang sudah ditutup ke Cold Storage sekaligus.</p>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap;">
        <select v-model="selectedTahunToArchive" class="form-select" style="max-width:260px;">
          <option value="">— Pilih Tahun Anggaran —</option>
          <option v-for="t in tahunList" :key="t.id" :value="t.id">
            Tahun {{ t.nama }} ({{ t.label }})
          </option>
        </select>
        <button
          class="btn btn-danger btn-sm"
          :disabled="!selectedTahunToArchive || archivingTahun"
          @click="confirmArchiveTahun"
        >
          <span v-if="archivingTahun" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
          📦 Arsipkan Seluruh Dokumen Tahun Ini
        </button>
      </div>
    </div>

    <!-- Toast Notification -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const API = '/api'

const diskUsage = ref({})
const tahunList = ref([])
const selectedTahunToArchive = ref('')
const toasts = ref([])

const form = ref({
  archive_lifecycle_days: 30,
  archive_lifecycle_time: '01:00',
  archive_lifecycle_enabled: '1',
})

const saving = ref(false)
const runningLifecycle = ref(false)
const archivingTahun = ref(false)

async function fetchDiskUsage() {
  try {
    const res = await axios.get(`${API}/archive/disk-usage`)
    diskUsage.value = res.data.storage || {}
  } catch (_) {}
}

async function fetchTahun() {
  try {
    const res = await axios.get(`${API}/tahun`)
    tahunList.value = res.data.tahun || []
  } catch (_) {}
}

async function fetchSettings() {
  try {
    const res = await axios.get(`${API}/backups/settings`)
    if (res.data.settings) {
      form.value.archive_lifecycle_days = parseInt(res.data.settings.archive_lifecycle_days || '30', 10)
      form.value.archive_lifecycle_time = res.data.settings.archive_lifecycle_time || '01:00'
      form.value.archive_lifecycle_enabled = res.data.settings.archive_lifecycle_enabled || '1'
    }
  } catch (_) {}
}

async function saveLifecycleSettings() {
  saving.value = true
  try {
    await axios.post(`${API}/backups/settings`, form.value)
    showToast('Pengaturan Lifecycle berhasil disimpan!', 'success')
  } catch (err) {
    showToast('Gagal menyimpan pengaturan: ' + (err.response?.data?.error || err.message), 'error')
  } finally {
    saving.value = false
  }
}

async function runLifecycleNow() {
  runningLifecycle.value = true
  showToast('Menjalankan proses kompresi & arsip lifecycle...', 'info')
  try {
    const res = await axios.post(`${API}/archive/run-lifecycle`)
    showToast(`Lifecycle selesai! Sukses: ${res.data.results?.success || 0}, Gagal: ${res.data.results?.failed || 0}`, 'success')
    await fetchDiskUsage()
  } catch (err) {
    showToast('Gagal menjalankan lifecycle: ' + (err.response?.data?.error || err.message), 'error')
  } finally {
    runningLifecycle.value = false
  }
}

async function confirmArchiveTahun() {
  const t = tahunList.value.find(item => item.id === selectedTahunToArchive.value)
  if (!confirm(`Apakah Anda yakin ingin mengarsipkan seluruh file aktif pada Tahun Anggaran ${t?.nama}? File akan dikompres dan dipindah ke Cold Storage.`)) return

  archivingTahun.value = true
  showToast(`Mengarsipkan seluruh dokumen tahun ${t?.nama}...`, 'info')
  try {
    const res = await axios.post(`${API}/archive/archive-tahun/${selectedTahunToArchive.value}`)
    showToast(res.data.message || 'Arsip tahun selesai!', 'success')
    await fetchDiskUsage()
    selectedTahunToArchive.value = ''
  } catch (err) {
    showToast('Gagal mengarsipkan tahun: ' + (err.response?.data?.error || err.message), 'error')
  } finally {
    archivingTahun.value = false
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function showToast(message, type = 'success') {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3200)
}

onMounted(() => {
  fetchDiskUsage()
  fetchTahun()
  fetchSettings()
})
</script>

<style scoped>
.archive-manager-view {
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
.disk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.2rem;
}
.disk-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
}
.dc-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 0.95rem;
}
.dc-metric {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--color-primary-dark);
}
.dc-path {
  margin-top: 0.4rem;
  font-size: 0.72rem;
  background: var(--color-bg);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  overflow-x: auto;
}
.section-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
}
.sc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-bottom: 1rem;
}
.sc-header h2 {
  font-size: 1.05rem;
  font-weight: 600;
}
.lifecycle-form .form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2rem;
}
.badge-hot {
  background: #FEF3C7;
  color: #B45309;
  border: 1px solid #FDE68A;
}
.badge-cold {
  background: #E0E7FF;
  color: #4338CA;
  border: 1px solid #C7D2FE;
}
</style>
