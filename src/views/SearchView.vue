<template>
  <div class="search-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">🔍 Pencarian Dokumen Terpadu</h1>
        <p class="caption">Cari cepat metadata dokumen di seluruh bidang, tahapan, sumber lokal & Google Drive</p>
      </div>
    </div>

    <!-- Filter & Search Bar -->
    <div class="search-bar-card">
      <div class="search-input-large">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Ketik nama file, modul, tahapan, atau kata kunci..."
          @keyup.enter="performSearch"
          class="main-search-input"
        />
        <button class="btn btn-primary" @click="performSearch" :disabled="loading">
          {{ loading ? 'Mencari...' : 'Cari' }}
        </button>
      </div>

      <div class="search-filters">
        <div class="filter-item">
          <label>Sumber:</label>
          <select v-model="filterSumber" @change="performSearch">
            <option value="all">Semua Sumber</option>
            <option value="local">Server Lokal</option>
            <option value="drive">Google Drive</option>
          </select>
        </div>

        <div class="filter-item">
          <label>Status Lokasi:</label>
          <select v-model="filterLocation" @change="performSearch">
            <option value="all">Semua Lokasi</option>
            <option value="hot">Aktif (Hot Storage)</option>
            <option value="archive">Arsip (Cold Storage)</option>
          </select>
        </div>

        <div class="filter-item">
          <label>Modul / Bidang:</label>
          <select v-model="filterBidang" @change="performSearch">
            <option value="all">Semua Modul</option>
            <option v-for="b in bidangs" :key="b.id" :value="b.id">{{ b.nama_bidang }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Multi-select action toolbar (hanya untuk file lokal) -->
    <div v-if="selectedFileIds.length > 0" class="batch-toolbar">
      <span class="batch-count">{{ selectedFileIds.length }} item dipilih</span>
      <button class="btn btn-primary btn-sm" @click="downloadSelectedZip" :disabled="zipping">
        <span v-if="zipping" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
        📦 Kompres & Unduh ZIP (File Lokal)
      </button>
      <button class="btn btn-outline btn-sm" @click="selectedFileIds = []">Batal Pilih</button>
      <span v-if="selectedDriveCount > 0" class="caption" style="color:var(--color-primary-dark);">
        ℹ️ {{ selectedDriveCount }} item Google Drive dilewati (tidak dapat di-zip).
      </span>
    </div>

    <!-- Results Table -->
    <div class="results-card">
      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>Mencari dokumen...</p>
      </div>

      <div v-else-if="results.length === 0" class="empty-state">
        <p>Tidak ada dokumen yang sesuai dengan kriteria pencarian.</p>
      </div>

      <div v-else class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px;">
                <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" />
              </th>
              <th>Nama Dokumen</th>
              <th>Sumber</th>
              <th>Status / Lokasi</th>
              <th>Modul</th>
              <th>Tahapan</th>
              <th>Ukuran</th>
              <th>Dibuat</th>
              <th style="text-align:right;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in results" :key="item.id">
              <td>
                <input
                  v-if="item.sumber === 'local'"
                  type="checkbox"
                  :value="item.id"
                  v-model="selectedFileIds"
                />
                <span v-else title="Google Drive tidak dapat dipilih untuk zip multi-file" style="opacity:0.3;">—</span>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:0.4rem;">
                  <span>{{ item.sumber === 'drive' ? '📁' : getFileEmoji(item.mime_type) }}</span>
                  <strong>{{ item.nama }}</strong>
                  <span v-if="item.pinned" class="badge badge-admin" title="Dokumen ini dipin agar tidak diarsipkan">📌 Pin</span>
                </div>
              </td>
              <td>
                <span class="badge" :class="item.sumber === 'drive' ? 'badge-drive' : 'badge-local'">
                  {{ item.sumber === 'drive' ? 'Google Drive' : 'Lokal Server' }}
                </span>
              </td>
              <td>
                <template v-if="item.sumber === 'drive'">
                  <span class="caption">Cloud Drive</span>
                </template>
                <template v-else>
                  <span class="badge" :class="item.location === 'hot' ? 'badge-hot' : 'badge-cold'">
                    {{ item.location === 'hot' ? 'Aktif' : 'Arsip' }}
                  </span>
                  <span v-if="item.compressed" class="caption" style="margin-left:4px;font-size:0.7rem;">(Zipped)</span>
                </template>
              </td>
              <td>{{ item.nama_bidang }}</td>
              <td>{{ item.nama_tahapan || 'Umum' }}</td>
              <td>{{ formatSize(item.size) }}</td>
              <td class="caption">{{ formatDate(item.created_at) }}</td>
              <td style="text-align:right;white-space:nowrap;">
                <!-- File Drive: Buka link -->
                <a
                  v-if="item.sumber === 'drive'"
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline btn-xs"
                >
                  Buka Link ↗
                </a>

                <!-- File Lokal -->
                <template v-else>
                  <button
                    class="btn btn-primary btn-xs"
                    @click="downloadLocal(item)"
                    :disabled="extractingId === item.id"
                  >
                    <span v-if="extractingId === item.id">Mengambil dari arsip...</span>
                    <span v-else-if="item.location === 'archive'">Ekstrak & Unduh ↓</span>
                    <span v-else>Unduh ↓</span>
                  </button>

                  <button
                    v-if="item.location === 'archive' && canManageFile(item)"
                    class="btn btn-outline btn-xs"
                    style="margin-left:4px;"
                    @click="restoreFile(item)"
                    title="Kembalikan file ke Hot Storage aktif"
                  >
                    Pulihkan ke Aktif
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

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

const searchQuery = ref('')
const filterSumber = ref('all')
const filterLocation = ref('all')
const filterBidang = ref('all')

const bidangs = ref([])
const results = ref([])
const loading = ref(false)
const extractingId = ref(null)
const zipping = ref(false)
const selectedFileIds = ref([])
const toasts = ref([])

const localResults = computed(() => results.value.filter(r => r.sumber === 'local'))
const isAllSelected = computed(() => {
  if (localResults.value.length === 0) return false
  return localResults.value.every(r => selectedFileIds.value.includes(r.id))
})
const selectedDriveCount = computed(() => {
  return results.value.filter(r => r.sumber === 'drive' && selectedFileIds.value.includes(r.id)).length
})

function canManageFile(item) {
  if (authStore.isSuperAdmin) return true
  if (authStore.isAdminBidang && authStore.user?.bidang_id === item.bidang_id) return true
  return false
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedFileIds.value = []
  } else {
    selectedFileIds.value = localResults.value.map(r => r.id)
  }
}

async function fetchBidangs() {
  try {
    const res = await axios.get(`${API}/bidang`)
    bidangs.value = res.data.bidangs || []
  } catch (_) {}
}

async function performSearch() {
  loading.value = true
  try {
    const res = await axios.get(`${API}/search`, {
      params: {
        q: searchQuery.value,
        sumber: filterSumber.value,
        location: filterLocation.value,
        bidang_id: filterBidang.value !== 'all' ? filterBidang.value : undefined
      }
    })
    results.value = res.data.results || []
  } catch (err) {
    showToast('Gagal memuat hasil pencarian.', 'error')
  } finally {
    loading.value = false
  }
}

async function downloadLocal(item) {
  if (item.location === 'archive') {
    extractingId.value = item.id
    showToast('Mengambil dari arsip & mengekstrak dokumen...', 'info')
  }
  try {
    const response = await axios.get(`${API}/local-files/${item.id}/download`, {
      responseType: 'blob'
    })
    const blob = new Blob([response.data])
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', item.nama)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (e) {
    showToast('Gagal mengunduh file.', 'error')
  } finally {
    extractingId.value = null
  }
}

async function restoreFile(item) {
  if (!confirm(`Pulihkan "${item.nama}" dari cold storage ke aktif (hot)?`)) return
  try {
    await axios.post(`${API}/local-files/${item.id}/restore`)
    showToast(`File "${item.nama}" berhasil dipulihkan ke aktif!`, 'success')
    await performSearch()
  } catch (e) {
    showToast(e.response?.data?.error || 'Gagal memulihkan file.', 'error')
  }
}

async function downloadSelectedZip() {
  if (selectedFileIds.value.length === 0) return
  zipping.value = true
  showToast('Menyiapkan file ZIP kompresi...', 'info')
  try {
    const response = await axios.post(`${API}/local-files/zip-download`, {
      file_ids: selectedFileIds.value
    }, {
      responseType: 'blob'
    })
    const blob = new Blob([response.data], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `unduhan_terpilih_${Date.now()}.zip`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    showToast('Unduhan ZIP berhasil!', 'success')
    selectedFileIds.value = []
  } catch (e) {
    showToast(e.response?.data?.error || 'Gagal membuat file ZIP.', 'error')
  } finally {
    zipping.value = false
  }
}

function getFileEmoji(mime) {
  if (!mime) return '📄'
  if (mime.includes('image')) return '🖼️'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('sheet') || mime.includes('excel')) return '📊'
  if (mime.includes('word')) return '📝'
  return '📄'
}

function formatSize(bytes) {
  if (!bytes) return '—'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function showToast(message, type = 'success') {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3200)
}

onMounted(async () => {
  await fetchBidangs()
  await performSearch()
})
</script>

<style scoped>
.search-view {
  padding: 1.5rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
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
.search-bar-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
}
.search-input-large {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0.35rem 0.6rem;
}
.main-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}
.search-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.filter-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}
.filter-item select {
  padding: 0.3rem 0.6rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  font-size: 0.82rem;
}
.batch-toolbar {
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  padding: 0.6rem 1rem;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.batch-count {
  font-weight: 600;
  font-size: 0.85rem;
  color: #1D4ED8;
}
.results-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1rem;
}
.table-responsive {
  overflow-x: auto;
}
.badge-drive {
  background: #EBF5FF;
  color: #1D4ED8;
  border: 1px solid #BFDBFE;
}
.badge-local {
  background: #ECFDF5;
  color: #047857;
  border: 1px solid #A7F3D0;
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
