import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

const API = '/api'

export const useAppStore = defineStore('app', () => {
  // Daftar tahun yang tersedia
  const tahunList = ref([])
  const loadingTahun = ref(false)

  // Tahun yang sedang dipilih (persist ke localStorage)
  const selectedTahunId = ref(localStorage.getItem('selected_tahun_id') || null)

  // Daftar modul/bidang untuk tahun yang dipilih
  const modulList = ref([])
  const loadingModul = ref(false)

  // Computed: objek tahun yang dipilih
  const selectedTahun = computed(() =>
    tahunList.value.find(t => t.id === selectedTahunId.value) || null
  )

  // Set tahun terpilih dan muat modulnya
  async function setSelectedTahun(tahunId) {
    selectedTahunId.value = tahunId
    localStorage.setItem('selected_tahun_id', tahunId)
    await fetchModul()
  }

  // Muat semua tahun dari server
  async function fetchTahun() {
    loadingTahun.value = true
    try {
      const res = await axios.get(`${API}/tahun`)
      tahunList.value = res.data.tahun || []

      // Auto-pilih tahun: pakai yang tersimpan, atau yang pertama
      const savedId = selectedTahunId.value
      const savedStillExists = tahunList.value.some(t => t.id === savedId)
      if (!savedStillExists && tahunList.value.length > 0) {
        await setSelectedTahun(tahunList.value[0].id)
      } else if (savedStillExists) {
        await fetchModul()
      }
    } catch (e) {
      console.error('Gagal memuat tahun:', e)
    } finally {
      loadingTahun.value = false
    }
  }

  // Muat modul/bidang untuk tahun yang dipilih
  async function fetchModul() {
    if (!selectedTahunId.value) return
    loadingModul.value = true
    try {
      const res = await axios.get(`${API}/bidang`, {
        params: { tahun_id: selectedTahunId.value }
      })
      modulList.value = res.data.bidangs || []
    } catch (e) {
      console.error('Gagal memuat modul:', e)
    } finally {
      loadingModul.value = false
    }
  }

  return {
    tahunList,
    selectedTahunId,
    selectedTahun,
    modulList,
    loadingTahun,
    loadingModul,
    fetchTahun,
    fetchModul,
    setSelectedTahun,
  }
})
