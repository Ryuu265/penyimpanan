<template>
  <div class="bidang-view">
    <!-- Header Konten: Judul & Nama Bidang yang Sedang Dilihat (Persis Sesuai Sketsa) -->
    <header class="page-header">
      <h1 class="page-title">Pusat Data Dokumen Perencanaan</h1>
      <div class="page-bidang-subtitle">
        Bidang: <strong>{{ currentBidang?.nama_bidang || 'Memuat...' }}</strong>
        <span class="user-role-text">({{ roleDisplayLabel }})</span>
      </div>
    </header>

    <!-- Section 1: Tahapan Proses Perencanaan (Alur Sederhana dengan Drag & Drop) -->
    <section class="section section-tahapan">
      <div class="section-header">
        <h2 class="section-title">Tahapan Proses Perencanaan</h2>

        <!-- Tombol + Tahapan (Hanya Admin Bidang & Super Admin) -->
        <div v-if="canEdit" class="section-header-actions">
          <button class="btn btn-primary btn-sm" @click="openAddTahapanModal">
            + Tahapan
          </button>
        </div>
      </div>

      <!-- Loading State Tahapan -->
      <div v-if="loadingTahapan" class="empty-state">
        <p>Memuat tahapan proses...</p>
      </div>

      <!-- Empty State Tahapan -->
      <div v-else-if="tahapanList.length === 0" class="empty-state">
        <p>Belum ada tahapan proses perencanaan.</p>
        <button v-if="canEdit" class="btn btn-primary btn-sm" @click="openAddTahapanModal">
          + Tambah Tahapan Baru
        </button>
      </div>

      <!-- Diagram Alur Horizontal (Drag & Drop + Tombol Panah ◀ ▶) -->
      <div v-else class="flow-wrapper">
        <div ref="flowContainerRef" class="flow-diagram">
          <div
            v-for="(step, idx) in tahapanList"
            :key="step.id"
            :data-id="step.id"
            class="flow-item"
          >
            <!-- Kotak Tahapan (Ukuran, Bentuk, dan Posisi Seragam) -->
            <div
              class="flow-box"
              :class="{
                'flow-box--editable': canEdit,
                'flow-box--active': selectedTahapanFilter === step.id
              }"
              @click="selectTahapan(step)"
              :title="`Klik untuk memfilter folder ${step.label}`"
            >
              <!-- Bar Aksi Edit & Hapus (Slot Kiri & Kanan Berukuran Pasti Sama) -->
              <div class="flow-box-actions">
                <div v-if="canEdit" class="flow-arrows-inline" @click.stop>
                  <button
                    class="btn-flow-nav"
                    :class="{ 'btn-flow-nav--hidden': idx === 0 }"
                    :disabled="idx === 0"
                    @click.stop="moveTahapan(idx, -1)"
                    title="Geser ke kiri"
                  >◀</button>
                  <button
                    class="btn-flow-nav"
                    :class="{ 'btn-flow-nav--hidden': idx === tahapanList.length - 1 }"
                    :disabled="idx === tahapanList.length - 1"
                    @click.stop="moveTahapan(idx, 1)"
                    title="Geser ke kanan"
                  >▶</button>
                </div>
                <div v-else class="flow-arrows-inline"></div>

                <div v-if="canEdit" class="flow-crud-btns" @click.stop>
                  <button
                    class="btn-flow-tool"
                    @click.stop="openEditTahapanModal(step)"
                    title="Edit tahapan"
                  >
                    ✏️
                  </button>
                  <button
                    class="btn-flow-tool danger"
                    @click.stop="confirmDeleteTahapan(step)"
                    title="Hapus tahapan"
                  >
                    🗑️
                  </button>
                </div>
                <div v-else class="flow-crud-btns"></div>
              </div>

              <!-- Konten Kotak: Ikon, Label, Deskripsi Terpusat -->
              <div class="flow-box-icon">{{ step.icon || '📋' }}</div>
              <div class="flow-box-label" :title="step.label">{{ step.label }}</div>
              <div class="flow-box-desc" :class="{ 'flow-box-desc--empty': !step.deskripsi }" :title="step.deskripsi || ''">
                {{ step.deskripsi || '—' }}
              </div>

              <!-- Footer Kotak: Nomor Tahap & Jumlah Folder Independen -->
              <div class="flow-box-footer">
                <span class="flow-box-step">Tahap {{ idx + 1 }}</span>
                <span class="flow-box-count">{{ getFolderCountForTahapan(step.id) }} folder</span>
              </div>
            </div>

            <!-- Panah ke Kanan -->
            <div class="flow-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: Tampilan File / Folder (Search Bar + Filter Kategori Tahapan) -->
    <section class="section section-folders">
      <div class="section-header">
        <h2 class="section-title">Tampilan File / Folder</h2>

        <!-- Filter Pencarian Kata Kunci & Filter Kategori Tahapan Berdampingan -->
        <div class="search-filter-row">
          <!-- Filter Kategori Tahapan (Dropdown) -->
          <div class="filter-select-wrap">
            <select v-model="selectedTahapanFilter" class="filter-select">
              <option value="all">Semua Kategori Tahapan (Independen)</option>
              <option value="umum">Kategori: Umum</option>
              <option v-for="t in tahapanList" :key="t.id" :value="t.id">
                Kategori: {{ t.label }}
              </option>
            </select>
          </div>

          <!-- Search Bar Sederhana -->
          <div class="search-input-wrap">
            <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Cari dokumen atau folder..."
              class="search-input"
            />
          </div>
        </div>
      </div>

      <!-- Banner Tahapan Aktif jika ada filter terpilih -->
      <div v-if="selectedTahapanObj" class="tahapan-active-banner">
        <div class="tab-info">
          <span class="tab-icon">{{ selectedTahapanObj.icon || '📋' }}</span>
          <div>
            <div class="tab-title">
              Tahapan: <strong>{{ selectedTahapanObj.label }}</strong>
              <span class="tab-badge">Folder Independen</span>
            </div>
            <div class="tab-subtitle">
              {{ selectedTahapanObj.deskripsi || 'Tahap proses perencanaan' }}
            </div>
          </div>
        </div>
        <div class="tab-actions">
          <button v-if="canAdd" class="btn btn-primary btn-sm" @click="openAddLocalFolderModal(selectedTahapanObj.id)">
            + Tambah Folder {{ selectedTahapanObj.label }}
          </button>
          <button v-if="canAdd" class="btn btn-outline btn-sm" @click="openImportGDriveModal(selectedTahapanObj.id)">
            📥 Salin dari Google Drive
          </button>
          <button class="btn btn-outline btn-sm" @click="selectedTahapanFilter = 'all'">
            ✕ Tampilkan Semua
          </button>
        </div>
      </div>

      <!-- Filter Folder Aktif -->
      <div v-if="selectedLocalFolderFilter" style="margin-bottom:0.75rem;padding:0.4rem 0.8rem;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;">
        <span>📁 Menyaring file dalam folder: <strong>{{ selectedLocalFolderFilter }}</strong></span>
        <button class="btn-link" @click="selectedLocalFolderFilter = null" style="font-size:0.8rem;color:var(--color-primary);cursor:pointer;background:none;border:none;font-weight:600;">✕ Hapus Filter Folder</button>
      </div>

      <!-- Loading State Folders -->
      <div v-if="loadingFolders || loadingLinks" class="empty-state">
        <p>Memuat daftar folder...</p>
      </div>

      <!-- Empty State Folders -->
      <div v-else-if="filteredLocalFolders.length === 0 && filteredLinks.length === 0" class="empty-state">
        <div class="empty-icon-wrap" style="font-size: 2.2rem; margin-bottom: 0.5rem;">📂</div>
        <p v-if="selectedTahapanObj">
          Belum ada folder dokumen untuk tahapan <strong>{{ selectedTahapanObj.label }}</strong>.
        </p>
        <p v-else-if="searchQuery">
          Tidak ada folder yang cocok dengan pencarian "<strong>{{ searchQuery }}</strong>".
        </p>
        <p v-else>
          Belum ada folder dokumen yang ditambahkan untuk bidang ini.
        </p>
        <div v-if="canAdd" style="display:flex;gap:0.5rem;justify-content:center;margin-top:0.8rem;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" @click="openAddLocalFolderModal(selectedTahapanObj?.id)">
            + Tambah Folder Lokal
          </button>
          <button class="btn btn-outline btn-sm" @click="openImportGDriveModal(selectedTahapanObj?.id)">
            📥 Salin dari Google Drive
          </button>
        </div>
      </div>

      <!-- Grid Folder Card -->
      <div v-else class="folder-grid">
        <!-- Local Folders (Penyimpanan Lokal Server) -->
        <LocalFolderCard
          v-for="folder in filteredLocalFolders"
          :key="folder.id"
          :folder="folder"
          :can-edit="canEdit"
          @click-folder="filterFilesByFolder(folder)"
          @upload-files="triggerFolderUpload(folder)"
          @edit="openEditLocalFolderModal(folder)"
          @delete="confirmDeleteLocalFolder(folder)"
        />

        <!-- Google Drive Links (jika ada tautan Google Drive) -->
        <FolderCard
          v-for="link in filteredLinks"
          :key="link.id"
          :link="link"
          :can-edit="authStore.canEditBidang(link.bidang_id)"
          @click-folder="openFolderFiles(link)"
          @edit="openEditModal(link)"
          @delete="confirmDelete(link)"
          @copy-to-local="openImportForDriveLink(link)"
        />
      </div>

      <!-- Hidden file input untuk upload langsung ke folder -->
      <input
        ref="folderFileInputRef"
        type="file"
        multiple
        @change="handleFolderUploadChange"
        style="display:none;"
      />

      <!-- Tombol Aksi di Bagian Bawah -->
      <div v-if="canAdd" class="bottom-action-area" style="display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-primary btn-md" @click="openAddLocalFolderModal(selectedTahapanObj?.id)">
          + Tambah Folder {{ selectedTahapanObj ? selectedTahapanObj.label : 'Lokal' }}
        </button>
        <button class="btn btn-outline btn-md" @click="openImportGDriveModal(selectedTahapanObj?.id)">
          📥 Salin dari Google Drive ke Lokal
        </button>
      </div>
    </section>

    <!-- Section 3: Dokumen Penyimpanan Lokal (Server Storage) -->
    <section class="section section-local-files" style="margin-top:1.5rem;">
      <div class="section-header">
        <div>
          <h2 class="section-title">📂 Dokumen & File Server Lokal</h2>
          <p class="caption">File tersimpan langsung di server lokal. Mendukung kompresi ZIP, ekstraksi arsip, dan backup otomatis.</p>
        </div>

        <div style="display:flex;gap:0.5rem;align-items:center;">
          <!-- Tombol Upload File Lokal -->
          <label v-if="canEdit" class="btn btn-primary btn-sm" :class="{ disabled: uploadingLocal }">
            <span v-if="uploadingLocal">⏳ Mengupload...</span>
            <span v-else>⬆️ Upload File Lokal</span>
            <input type="file" multiple @change="handleUploadLocalFiles" style="display:none" :disabled="uploadingLocal" />
          </label>
        </div>
      </div>

      <!-- Toolbar Multi-Select Kompresi ZIP & Kompres Ukuran Media -->
      <div v-if="selectedLocalIds.length > 0" class="batch-toolbar" style="margin-bottom:1rem;background:#EFF6FF;padding:0.6rem 1rem;border-radius:var(--radius-md);display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
        <span class="batch-count" style="font-weight:600;font-size:0.85rem;color:#1D4ED8;">{{ selectedLocalIds.length }} file lokal dipilih</span>
        <button class="btn btn-primary btn-sm" @click="downloadLocalZipBatch" :disabled="zippingLocal">
          <span v-if="zippingLocal" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
          📦 Kompres / Download ZIP (Struktur Terjaga)
        </button>
        <button v-if="canEdit" class="btn btn-outline btn-sm" @click="compressMediaBatchAction" :disabled="compressingBatch">
          <span v-if="compressingBatch" class="spinner" style="width:12px;height:12px;border-width:2px;"></span>
          🗜️ Kompres Ukuran Gambar/PDF
        </button>
        <button class="btn btn-outline btn-sm" @click="selectedLocalIds = []">Batal Pilih</button>
      </div>

      <!-- Loading State Local Files -->
      <div v-if="loadingLocalFiles" class="empty-state">
        <p>Memuat file penyimpanan lokal...</p>
      </div>

      <!-- Empty State Local Files -->
      <div v-else-if="filteredLocalFiles.length === 0" class="empty-state">
        <p>Belum ada file lokal yang diunggah untuk modul ini.</p>
      </div>

      <!-- Table Local Files -->
      <div v-else class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px;">
                <input type="checkbox" :checked="isAllLocalSelected" @change="toggleSelectAllLocal" />
              </th>
              <th>Nama File</th>
              <th>Status / Lokasi</th>
              <th>Tahapan</th>
              <th>Ukuran</th>
              <th>Diunggah Oleh</th>
              <th>Tanggal</th>
              <th style="text-align:right;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lf in filteredLocalFiles" :key="lf.id">
              <td>
                <input type="checkbox" :value="lf.id" v-model="selectedLocalIds" />
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:0.4rem;">
                  <span>{{ getLocalFileEmoji(lf.mime_type) }}</span>
                  <strong>{{ lf.original_name }}</strong>
                  <span v-if="lf.pinned" class="badge badge-admin" title="Dokumen ini dipin agar tidak diarsipkan">📌 Pin</span>
                </div>
              </td>
              <td>
                <span class="badge" :class="lf.location === 'hot' ? 'badge-hot' : 'badge-cold'">
                  {{ lf.location === 'hot' ? 'Aktif (Hot)' : 'Arsip (Cold)' }}
                </span>
                <span v-if="lf.compressed" class="caption" style="margin-left:4px;font-size:0.7rem;">(Zipped)</span>
              </td>
              <td>{{ lf.nama_tahapan || 'Umum' }}</td>
              <td>{{ formatSize(lf.size) }}</td>
              <td class="caption">{{ lf.uploaded_by }}</td>
              <td class="caption">{{ formatDate(lf.created_at) }}</td>
              <td style="text-align:right;white-space:nowrap;">
                <!-- Download button -->
                <button class="btn btn-primary btn-xs" @click="downloadLocalFile(lf)" :disabled="extractingLocalId === lf.id">
                  <span v-if="extractingLocalId === lf.id">Mengambil...</span>
                  <span v-else-if="lf.location === 'archive'">Ekstrak & Unduh ↓</span>
                  <span v-else>Unduh ↓</span>
                </button>

                <!-- Kompres Ukuran Gambar/PDF (Hot Storage Only) -->
                <button
                  v-if="lf.location === 'hot' && isCompressible(lf.mime_type, lf.original_name) && canEdit"
                  class="btn btn-outline btn-xs"
                  style="margin-left:4px;"
                  :disabled="compressingLocalId === lf.id"
                  @click="compressMediaSingle(lf)"
                  title="Kompres ukuran gambar/PDF secara fisik"
                >
                  <span v-if="compressingLocalId === lf.id">...</span>
                  <span v-else>🗜️ Kompres</span>
                </button>

                <!-- Pulihkan ke Aktif (jika arsip) -->
                <button
                  v-if="lf.location === 'archive' && canEdit"
                  class="btn btn-outline btn-xs"
                  style="margin-left:4px;"
                  @click="restoreLocalFile(lf)"
                  title="Kembalikan file ke Hot Storage"
                >
                  Pulihkan ke Aktif
                </button>

                <!-- Toggle Pin (Jangan arsipkan) -->
                <button
                  v-if="canEdit"
                  class="btn-icon"
                  style="margin-left:4px;"
                  :title="lf.pinned ? 'Lepas Pin' : 'Pin agar tidak diarsipkan'"
                  @click="togglePinLocalFile(lf)"
                >
                  {{ lf.pinned ? '📌' : '📍' }}
                </button>

                <!-- Hapus File Lokal -->
                <button
                  v-if="canEdit"
                  class="btn-icon danger"
                  style="margin-left:4px;"
                  title="Hapus file lokal"
                  @click="deleteLocalFile(lf)"
                >
                  🗑️
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MODAL: Tambah / Edit Folder Lokal Server -->
    <Teleport to="body">
      <div v-if="showLocalFolderModal" class="modal-overlay" @click.self="closeLocalFolderModal">
        <div class="modal-box">
          <div class="modal-header">
            <h3>{{ editingLocalFolder ? 'Edit Nama Folder Lokal' : 'Tambah Folder Penyimpanan Lokal' }}</h3>
            <button class="btn-icon" @click="closeLocalFolderModal">✕</button>
          </div>
          <form @submit.prevent="submitLocalFolderForm">
            <div class="form-group">
              <label>Nama Folder <span class="text-danger">*</span></label>
              <input v-model="localFolderForm.nama_folder" placeholder="contoh: RPJMD 2025, Dinas Kesehatan, dll." required />
              <p class="caption">Nama folder akan disanitasi secara otomatis untuk nama direktori fisik server.</p>
            </div>

            <div class="form-group">
              <label>Kategori Tahapan <span class="text-danger">*</span></label>
              <select v-model="localFolderForm.tahapan_id" class="form-select" required>
                <option value="" disabled>-- Pilih Tahapan --</option>
                <option v-for="t in tahapanList" :key="t.id" :value="t.id">
                  {{ t.label }} {{ t.deskripsi ? `— ${t.deskripsi}` : '' }}
                </option>
              </select>
            </div>

            <div v-if="localFolderFormError" class="error-alert">
              {{ localFolderFormError }}
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-outline" @click="closeLocalFolderModal">Batal</button>
              <button type="submit" class="btn btn-primary" :disabled="localFolderFormLoading">
                {{ editingLocalFolder ? 'Simpan Nama Folder' : 'Buat Folder Lokal' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Salin dari Google Drive ke Server Lokal -->
    <Teleport to="body">
      <div v-if="showImportGDriveModal" class="modal-overlay" @click.self="closeImportGDriveModal">
        <div class="modal-box modal-box--large">
          <div class="modal-header">
            <div>
              <h3>📥 Salin Dokumen dari Google Drive ke Server Lokal</h3>
              <p class="caption">Unduh dan simpan dokumen dari Google Drive secara permanen ke hot storage server.</p>
            </div>
            <button class="btn-icon" @click="closeImportGDriveModal">✕</button>
          </div>

          <div style="padding: 1rem 0;">
            <div class="form-group">
              <label>Link Folder / File Google Drive atau ID <span class="text-danger">*</span></label>
              <div style="display:flex;gap:0.5rem;">
                <input v-model="importGDriveForm.drive_url_or_id" placeholder="https://drive.google.com/drive/folders/... atau ID file" style="flex:1;" />
                <button type="button" class="btn btn-outline btn-sm" @click="inspectDriveLink" :disabled="inspectingDrive">
                  <span v-if="inspectingDrive">Memeriksa...</span>
                  <span v-else>🔍 Periksa</span>
                </button>
              </div>
            </div>

            <!-- Preview Hasil Pemeriksaan Link -->
            <div v-if="inspectedDriveInfo" style="margin-bottom:1rem;padding:0.75rem;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:var(--radius-sm);font-size:0.85rem;">
              <div style="display:flex;align-items:center;gap:0.4rem;font-weight:600;">
                <span>{{ inspectedDriveInfo.isFolder ? '📁 Folder Drive:' : '📄 File Drive:' }}</span>
                <span>{{ inspectedDriveInfo.name }}</span>
              </div>
              <div class="caption" style="margin-top:0.25rem;">
                <span v-if="inspectedDriveInfo.isFolder">{{ inspectedDriveInfo.fileCount }} file ditemukan di dalam folder.</span>
                <span v-else>Ukuran: {{ formatSize(inspectedDriveInfo.size) }}</span>
              </div>
            </div>

            <div class="form-group">
              <label>Simpan ke Tahapan <span class="text-danger">*</span></label>
              <select v-model="importGDriveForm.tahapan_id" class="form-select" required>
                <option value="">-- Umum / Tanpa Tahapan Khusus --</option>
                <option v-for="t in tahapanList" :key="t.id" :value="t.id">
                  {{ t.label }} {{ t.deskripsi ? `— ${t.deskripsi}` : '' }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>Nama Subfolder Lokal (Opsional)</label>
              <input v-model="importGDriveForm.folder_name" placeholder="Biarkan kosong untuk menggunakan nama asli dari Drive" />
            </div>

            <div v-if="importError" class="error-alert">
              {{ importError }}
            </div>

            <!-- Progress Indicator -->
            <div v-if="importingGDrive" style="margin-top:1rem;padding:0.75rem;background:#EFF6FF;border-radius:var(--radius-sm);display:flex;align-items:center;gap:0.75rem;">
              <div class="spinner" style="width:18px;height:18px;border-width:2.5px;"></div>
              <div>
                <strong style="color:#1D4ED8;font-size:0.85rem;">Sedang menyalin dari Google Drive...</strong>
                <p class="caption" style="margin:0;">File sedang diunduh dan diproses ke penyimpanan server.</p>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" @click="closeImportGDriveModal" :disabled="importingGDrive">Batal</button>
            <button type="button" class="btn btn-primary" @click="startImportGDrive" :disabled="importingGDrive || !importGDriveForm.drive_url_or_id">
              {{ importingGDrive ? 'Menyalin...' : 'Mulai Salin ke Lokal' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Hapus Folder Lokal -->
    <Teleport to="body">
      <div v-if="deletingLocalFolder" class="modal-overlay" @click.self="deletingLocalFolder = null">
        <div class="modal-box">
          <div class="modal-header">
            <h3>Konfirmasi Hapus Folder Lokal</h3>
            <button class="btn-icon" @click="deletingLocalFolder = null">✕</button>
          </div>

          <div v-if="folderDeleteData" class="error-alert" style="margin-bottom:0.75rem;">
            ⚠️ {{ folderDeleteData.message }}
          </div>
          <p v-else class="modal-desc">
            Hapus folder <strong>"{{ deletingLocalFolder.nama_folder }}"</strong> dari sistem dan direktori server?
          </p>

          <div class="modal-footer">
            <button class="btn btn-outline" @click="deletingLocalFolder = null; folderDeleteData = null;">Batal</button>
            <button
              v-if="folderDeleteData"
              class="btn btn-danger"
              @click="executeDeleteLocalFolder(true)"
              :disabled="localFolderFormLoading"
            >
              Hapus Folder & Seluruh Isinya
            </button>
            <button
              v-else
              class="btn btn-danger"
              @click="executeDeleteLocalFolder(false)"
              :disabled="localFolderFormLoading"
            >
              Hapus Folder
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Tambah / Edit Folder Google Drive (Legacy) -->
    <Teleport to="body">
      <div v-if="showFolderModal" class="modal-overlay" @click.self="closeFolderModal">
        <div class="modal-box">
          <div class="modal-header">
            <h3>{{ editingLink ? 'Edit Link Folder Google Drive' : 'Tambah Link Folder Google Drive' }}</h3>
            <button class="btn-icon" @click="closeFolderModal">✕</button>
          </div>
          <form @submit.prevent="submitFolderForm">
            <div class="form-group">
              <label>Nama Tampilan Folder <span class="text-danger">*</span></label>
              <input v-model="folderForm.nama_folder" placeholder="contoh: RPJMD 2025-2029" required />
            </div>

            <div class="form-group">
              <label>Link Folder Google Drive <span class="text-danger">*</span></label>
              <input v-model="folderForm.drive_folder_url" placeholder="https://drive.google.com/drive/folders/..." required />
            </div>

            <!-- Dropdown Pilihan Kategori Tahapan Penggolongan -->
            <div class="form-group">
              <label>Kategori Tahapan</label>
              <select v-model="folderForm.tahapan_id" class="form-select">
                <option value="">Umum</option>
                <option v-for="t in tahapanList" :key="t.id" :value="t.id">
                  {{ t.label }} {{ t.deskripsi ? `— ${t.deskripsi}` : '' }}
                </option>
              </select>
            </div>

            <div v-if="formError" class="error-alert">
              {{ formError }}
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-outline" @click="closeFolderModal">Batal</button>
              <button type="submit" class="btn btn-primary" :disabled="formLoading">
                {{ editingLink ? 'Simpan Perubahan' : 'Tambah Link' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Tambah / Edit Tahapan Perencanaan -->
    <Teleport to="body">
      <div v-if="showTahapanModal" class="modal-overlay" @click.self="closeTahapanModal">
        <div class="modal-box">
          <div class="modal-header">
            <h3>{{ editingTahapan ? 'Edit Tahapan' : 'Tambah Tahapan Perencanaan' }}</h3>
            <button class="btn-icon" @click="closeTahapanModal">✕</button>
          </div>
          <form @submit.prevent="submitTahapanForm">
            <div class="form-group">
              <label>Nama Tahapan <span class="text-danger">*</span></label>
              <input v-model="tahapanForm.label" placeholder="contoh: RPJMD, RKPD, dll." required />
            </div>

            <div class="form-group">
              <label>Keterangan Singkat</label>
              <input v-model="tahapanForm.deskripsi" placeholder="contoh: Rencana Kerja Pemerintah Daerah" />
            </div>

            <div class="form-group">
              <label>Ikon Kotak</label>
              <div class="icon-picker">
                <button
                  type="button"
                  v-for="ic in iconPresets"
                  :key="ic"
                  class="btn-icon-choice"
                  :class="{ 'active': tahapanForm.icon === ic }"
                  @click="tahapanForm.icon = ic"
                >
                  {{ ic }}
                </button>
              </div>
            </div>

            <div v-if="tahapanFormError" class="error-alert">
              {{ tahapanFormError }}
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-outline" @click="closeTahapanModal">Batal</button>
              <button type="submit" class="btn btn-primary" :disabled="tahapanFormLoading">
                {{ editingTahapan ? 'Simpan' : 'Tambah Tahapan' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Hapus Tahapan -->
    <Teleport to="body">
      <div v-if="deletingTahapan" class="modal-overlay" @click.self="deletingTahapan = null">
        <div class="modal-box">
          <div class="modal-header">
            <h3>Konfirmasi Hapus Tahapan</h3>
            <button class="btn-icon" @click="deletingTahapan = null">✕</button>
          </div>

          <div v-if="tahapanDeleteData" class="error-alert" style="margin-bottom:0.75rem;">
            ⚠️ {{ tahapanDeleteData.message }}
          </div>
          <p v-else class="modal-desc">
            Hapus tahapan <strong>"{{ deletingTahapan.label }}"</strong> dari alur proses beserta direktori fisiknya?
          </p>

          <div class="modal-footer">
            <button class="btn btn-outline" @click="deletingTahapan = null; tahapanDeleteData = null;">Batal</button>
            <button
              v-if="tahapanDeleteData"
              class="btn btn-danger"
              @click="executeDeleteTahapan(true)"
              :disabled="tahapanFormLoading"
            >
              Hapus Tahapan & Seluruh Isinya
            </button>
            <button
              v-else
              class="btn btn-danger"
              @click="executeDeleteTahapan(false)"
              :disabled="tahapanFormLoading"
            >
              Hapus Tahapan
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Hapus Folder Google Drive -->
    <Teleport to="body">
      <div v-if="deletingLink" class="modal-overlay" @click.self="deletingLink = null">
        <div class="modal-box">
          <div class="modal-header">
            <h3>Konfirmasi Hapus Link Google Drive</h3>
            <button class="btn-icon" @click="deletingLink = null">✕</button>
          </div>
          <p class="modal-desc">
            Hapus tautan folder <strong>"{{ deletingLink.nama_folder }}"</strong> dari sistem?
          </p>
          <p class="caption">File asli di Google Drive tidak akan terhapus.</p>
          <div class="modal-footer">
            <button class="btn btn-outline" @click="deletingLink = null">Batal</button>
            <button class="btn btn-danger" @click="executeDelete" :disabled="formLoading">
              Hapus Link
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- MODAL: Jelajahi Isi File Folder (In-App Navigator dengan Breadcrumb) -->
    <Teleport to="body">
      <div v-if="selectedFolder" class="modal-overlay" @click.self="selectedFolder = null">
        <div class="modal-box modal-box--large">
          <div class="modal-header">
            <div>
              <h3>{{ selectedFolder.nama_folder }}</h3>
              <div class="caption">Bidang: {{ selectedFolder.nama_bidang }} &middot; Kategori: {{ selectedFolder.nama_tahapan || 'Umum' }}</div>
            </div>
            <div class="modal-header-btns">
              <a :href="selectedFolder.drive_folder_url" target="_blank" class="btn btn-outline btn-sm">
                Buka di Drive ↗
              </a>
              <button class="btn-icon" @click="selectedFolder = null">✕</button>
            </div>
          </div>

          <!-- In-App Folder Explorer dengan Breadcrumb -->
          <FolderExplorer
            :root-folder-id="explorerRootId"
            :root-folder-name="explorerRootName"
            :service-account-email="serviceAccountEmail"
            @copy-sa-email="copyServiceAccountEmail"
          />
        </div>
      </div>
    </Teleport>

    <!-- Toast Notification -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
        {{ t.message }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import Sortable from 'sortablejs'
import { useAuthStore } from '../stores/auth'
import FolderCard from '../components/FolderCard.vue'
import FolderExplorer from '../components/FolderExplorer.vue'
import LocalFolderCard from '../components/LocalFolderCard.vue'

const props = defineProps({
  slug: String,      // legacy: 'perencanaan' | 'palev'
  bidangId: String   // baru: ID bidang langsung dari route /dashboard/modul/:bidangId
})
const route = useRoute()
const authStore = useAuthStore()
const API = '/api'

const serviceAccountEmail = 'drivereader@quiet-engine-507202-a5.iam.gserviceaccount.com'
const copiedSa = ref(false)
const iconPresets = ['📋', '📅', '📄', '💰', '✅', '🔍', '📊', '📑', '💡', '🎯', '📌', '🚀']

// State Bidang & Drive Links
const bidangs = ref([])
const driveLinks = ref([])
const loadingLinks = ref(true)
const searchQuery = ref('')
const selectedTahapanFilter = ref('all')
const toasts = ref([])

// State Tahapan
const tahapanList = ref([])
const loadingTahapan = ref(true)
const flowContainerRef = ref(null)
let sortableInstance = null

// State Folder Lokal
const localFolders = ref([])
const loadingFolders = ref(false)
const selectedLocalFolderFilter = ref(null)
const showLocalFolderModal = ref(false)
const editingLocalFolder = ref(null)
const deletingLocalFolder = ref(null)
const folderDeleteData = ref(null)
const localFolderForm = ref({ nama_folder: '', tahapan_id: '' })
const localFolderFormError = ref('')
const localFolderFormLoading = ref(false)
const folderFileInputRef = ref(null)
const targetFolderUpload = ref(null)

// State Salin dari Google Drive
const showImportGDriveModal = ref(false)
const importGDriveForm = ref({ drive_url_or_id: '', tahapan_id: '', folder_name: '' })
const inspectingDrive = ref(false)
const inspectedDriveInfo = ref(null)
const importingGDrive = ref(false)
const importError = ref('')

// Modals Folder Google Drive (Legacy)
const showFolderModal = ref(false)
const editingLink = ref(null)
const deletingLink = ref(null)
const selectedFolder = ref(null)
// Explorer state (navigasi in-app)
const explorerRootId = ref('')
const explorerRootName = ref('')
const formLoading = ref(false)
const formError = ref('')
const folderForm = ref({ nama_folder: '', drive_folder_url: '', tahapan_id: '' })

// Modals Tahapan
const showTahapanModal = ref(false)
const editingTahapan = ref(null)
const deletingTahapan = ref(null)
const tahapanDeleteData = ref(null)
const tahapanFormLoading = ref(false)
const tahapanFormError = ref('')
const tahapanForm = ref({ label: '', deskripsi: '', icon: '📋' })

// State Local Files (Server Storage)
const localFiles = ref([])
const loadingLocalFiles = ref(false)
const uploadingLocal = ref(false)
const selectedLocalIds = ref([])
const zippingLocal = ref(false)
const compressingBatch = ref(false)
const compressingLocalId = ref(null)
const extractingLocalId = ref(null)

// Computed: Bidang Aktif
const currentBidang = computed(() => {
  // Mode baru: bidangId prop (dari route /dashboard/modul/:bidangId)
  if (props.bidangId) {
    return bidangs.value.find(b => b.id === props.bidangId) || null
  }
  // Mode legacy: slug-based
  const slug = props.slug || 'perencanaan'
  if (slug === 'perencanaan') return bidangs.value.find(b => b.nama_bidang?.toLowerCase().includes('perencanaan'))
  if (slug === 'palev') return bidangs.value.find(b => b.nama_bidang?.toLowerCase().includes('palev') || b.nama_bidang?.toLowerCase().includes('pengendalian'))
  return bidangs.value.find(b => b.id === slug) || bidangs.value[0]
})

// Hak akses mengedit bidang ini (Super Admin OR Admin Bidang pemilik)
const canEdit = computed(() => {
  if (!authStore.user) return false
  if (authStore.isSuperAdmin) return true
  if (authStore.isAdminBidang && currentBidang.value?.id) {
    return authStore.user.bidang_id === currentBidang.value.id
  }
  return false
})
const canAdd = computed(() => canEdit.value)

const roleDisplayLabel = computed(() => {
  if (authStore.isSuperAdmin) return 'Super Admin'
  if (authStore.isAdminBidang) {
    return canEdit.value ? 'Admin Bidang Ini' : 'Admin Bidang Lain'
  }
  return 'Viewer (Akses Baca)'
})

// Computed Local Files: filter by currentBidang, selectedTahapanFilter, selectedLocalFolderFilter, & search
const filteredLocalFiles = computed(() => {
  if (!currentBidang.value?.id) return []
  let files = localFiles.value.filter(f => f.bidang_id === currentBidang.value.id)

  if (selectedTahapanFilter.value === 'umum') {
    files = files.filter(f => !f.tahapan_id)
  } else if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all') {
    files = files.filter(f => f.tahapan_id === selectedTahapanFilter.value)
  }

  if (selectedLocalFolderFilter.value) {
    files = files.filter(f => f.folder_path === selectedLocalFolderFilter.value || (f.folder_path && f.folder_path.startsWith(selectedLocalFolderFilter.value + '/')))
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    files = files.filter(f =>
      f.original_name.toLowerCase().includes(q) ||
      (f.nama_tahapan && f.nama_tahapan.toLowerCase().includes(q)) ||
      (f.folder_path && f.folder_path.toLowerCase().includes(q))
    )
  }

  return files
})

// Computed Local Folders: filter by currentBidang & selectedTahapanFilter & search
const filteredLocalFolders = computed(() => {
  if (!currentBidang.value?.id) return []
  let folders = localFolders.value.filter(f => f.bidang_id === currentBidang.value.id)

  if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all') {
    folders = folders.filter(f => f.tahapan_id === selectedTahapanFilter.value)
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    folders = folders.filter(f =>
      f.nama_folder.toLowerCase().includes(q) ||
      (f.nama_tahapan && f.nama_tahapan.toLowerCase().includes(q))
    )
  }

  return folders
})

const isAllLocalSelected = computed(() => {
  if (filteredLocalFiles.value.length === 0) return false
  return filteredLocalFiles.value.every(f => selectedLocalIds.value.includes(f.id))
})

// Filter Dokumen: Gabungan Kata Kunci (searchQuery) DAN Kategori Tahapan (selectedTahapanFilter)
const filteredLinks = computed(() => {
  let links = driveLinks.value.filter(l => l.bidang_id === currentBidang.value?.id)

  // Filter Kategori Tahapan
  if (selectedTahapanFilter.value === 'umum') {
    links = links.filter(l => !l.tahapan_id)
  } else if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all') {
    links = links.filter(l => l.tahapan_id === selectedTahapanFilter.value)
  }

  // Filter Kata Kunci
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    links = links.filter(l =>
      l.nama_folder.toLowerCase().includes(q) ||
      l.nama_bidang?.toLowerCase().includes(q) ||
      (l.nama_tahapan && l.nama_tahapan.toLowerCase().includes(q))
    )
  }

  return links
})

const selectedTahapanObj = computed(() => {
  if (!selectedTahapanFilter.value || selectedTahapanFilter.value === 'all' || selectedTahapanFilter.value === 'umum') return null
  return tahapanList.value.find(t => t.id === selectedTahapanFilter.value) || null
})

function getFolderCountForTahapan(tahapanId) {
  const step = tahapanList.value.find(t => t.id === tahapanId)
  if (step && typeof step.folder_count === 'number') {
    return step.folder_count
  }
  return localFolders.value.filter(f => f.tahapan_id === tahapanId).length
}

function selectTahapan(step) {
  if (selectedTahapanFilter.value === step.id) {
    selectedTahapanFilter.value = 'all'
  } else {
    selectedTahapanFilter.value = step.id
  }
}

// Fetch API
async function fetchBidangs() {
  try {
    const res = await axios.get(`${API}/bidang`)
    bidangs.value = res.data.bidangs || []
  } catch (e) {
    showToast('Gagal memuat daftar bidang.', 'error')
  }
}

async function fetchDriveLinks() {
  loadingLinks.value = true
  try {
    const res = await axios.get(`${API}/drive-links`)
    driveLinks.value = res.data.links || []
  } catch (e) {
    showToast('Gagal memuat folder dokumen.', 'error')
  } finally {
    loadingLinks.value = false
  }
}

async function fetchTahapan() {
  if (!currentBidang.value?.id) return
  loadingTahapan.value = true
  try {
    const res = await axios.get(`${API}/tahapan`, {
      params: { bidang_id: currentBidang.value.id }
    })
    tahapanList.value = res.data.tahapan || []
  } catch (err) {
    showToast('Gagal memuat tahapan proses.', 'error')
  } finally {
    loadingTahapan.value = false
    await nextTick()
    setupSortable()
  }
}

// Inisialisasi Drag & Drop dengan SortableJS
function setupSortable() {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }

  if (!flowContainerRef.value || !canEdit.value) return

  sortableInstance = new Sortable(flowContainerRef.value, {
    animation: 250,
    draggable: '.flow-item',
    filter: 'button, a, input, select',
    preventOnFilter: false,
    ghostClass: 'sortable-ghost',
    forceFallback: true,
    fallbackTolerance: 3,
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return

      const movedItem = tahapanList.value.splice(evt.oldIndex, 1)[0]
      tahapanList.value.splice(evt.newIndex, 0, movedItem)

      await saveReorder()
    }
  })
}

async function saveReorder() {
  const itemsToSave = tahapanList.value.map((t, index) => ({
    id: t.id,
    urutan: index
  }))

  try {
    await axios.put(`${API}/tahapan/reorder`, {
      bidang_id: currentBidang.value.id,
      items: itemsToSave
    })
    showToast('Urutan tahapan berhasil disimpan.', 'success')
  } catch (err) {
    showToast('Gagal menyimpan urutan tahapan.', 'error')
    await fetchTahapan()
  }
}

// Tombol Geser Cepat
async function moveTahapan(idx, direction) {
  const newIdx = idx + direction
  if (newIdx < 0 || newIdx >= tahapanList.value.length) return

  const item = tahapanList.value.splice(idx, 1)[0]
  tahapanList.value.splice(newIdx, 0, item)

  await saveReorder()
}

// Modal Tahapan
function openAddTahapanModal() {
  editingTahapan.value = null
  tahapanForm.value = { label: '', deskripsi: '', icon: '📋' }
  tahapanFormError.value = ''
  showTahapanModal.value = true
}

function openEditTahapanModal(step) {
  editingTahapan.value = step
  tahapanForm.value = {
    label: step.label,
    deskripsi: step.deskripsi || '',
    icon: step.icon || '📋'
  }
  tahapanFormError.value = ''
  showTahapanModal.value = true
}

function closeTahapanModal() {
  showTahapanModal.value = false
  editingTahapan.value = null
  tahapanFormError.value = ''
}

async function submitTahapanForm() {
  tahapanFormError.value = ''
  tahapanFormLoading.value = true

  try {
    if (editingTahapan.value) {
      await axios.put(`${API}/tahapan/${editingTahapan.value.id}`, tahapanForm.value)
      showToast('Tahapan berhasil diperbarui.', 'success')
    } else {
      await axios.post(`${API}/tahapan`, {
        ...tahapanForm.value,
        bidang_id: currentBidang.value?.id
      })
      showToast('Tahapan berhasil ditambahkan.', 'success')
    }
    closeTahapanModal()
    await fetchTahapan()
  } catch (err) {
    tahapanFormError.value = err.response?.data?.error || 'Gagal menyimpan tahapan.'
  } finally {
    tahapanFormLoading.value = false
  }
}

function confirmDeleteTahapan(step) {
  deletingTahapan.value = step
}

async function executeDeleteTahapan(force = false) {
  if (!deletingTahapan.value) return
  tahapanFormLoading.value = true

  try {
    const url = `${API}/tahapan/${deletingTahapan.value.id}${force ? '?force=1' : ''}`
    await axios.delete(url)
    showToast('Tahapan berhasil dihapus.', 'success')
    deletingTahapan.value = null
    tahapanDeleteData.value = null
    await Promise.all([fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
  } catch (err) {
    if (err.response?.status === 409 && err.response?.data?.needs_confirm) {
      tahapanDeleteData.value = err.response.data
    } else {
      showToast(err.response?.data?.error || 'Gagal menghapus tahapan.', 'error')
    }
  } finally {
    tahapanFormLoading.value = false
  }
}

// ─── LOCAL FOLDERS HANDLERS ────────────────────────────────────────────────
async function fetchLocalFolders() {
  if (!currentBidang.value?.id) return
  loadingFolders.value = true
  try {
    const res = await axios.get(`${API}/tahapan/folders/all`, {
      params: { bidang_id: currentBidang.value.id }
    })
    localFolders.value = res.data.folders || []
  } catch (err) {
    localFolders.value = []
  } finally {
    loadingFolders.value = false
  }
}

function openAddLocalFolderModal(prefillTahapanId = null) {
  editingLocalFolder.value = null
  let defaultTahapan = ''
  if (typeof prefillTahapanId === 'string' && prefillTahapanId) {
    defaultTahapan = prefillTahapanId
  } else if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all' && selectedTahapanFilter.value !== 'umum') {
    defaultTahapan = selectedTahapanFilter.value
  } else if (tahapanList.value.length > 0) {
    defaultTahapan = tahapanList.value[0].id
  }
  localFolderForm.value = { nama_folder: '', tahapan_id: defaultTahapan }
  localFolderFormError.value = ''
  showLocalFolderModal.value = true
}

function openEditLocalFolderModal(folder) {
  editingLocalFolder.value = folder
  localFolderForm.value = {
    nama_folder: folder.nama_folder,
    tahapan_id: folder.tahapan_id
  }
  localFolderFormError.value = ''
  showLocalFolderModal.value = true
}

function closeLocalFolderModal() {
  showLocalFolderModal.value = false
  editingLocalFolder.value = null
  localFolderFormError.value = ''
}

async function submitLocalFolderForm() {
  localFolderFormError.value = ''
  localFolderFormLoading.value = true

  const thpId = localFolderForm.value.tahapan_id
  if (!thpId) {
    localFolderFormError.value = 'Silakan pilih tahapan untuk folder ini.'
    localFolderFormLoading.value = false
    return
  }

  try {
    if (editingLocalFolder.value) {
      await axios.put(`${API}/tahapan/${editingLocalFolder.value.tahapan_id}/folders/${editingLocalFolder.value.id}`, {
        nama_folder: localFolderForm.value.nama_folder
      })
      showToast('Nama folder berhasil diperbarui.', 'success')
    } else {
      await axios.post(`${API}/tahapan/${thpId}/folders`, {
        nama_folder: localFolderForm.value.nama_folder
      })
      showToast('Folder lokal berhasil dibuat di direktori server.', 'success')
    }
    closeLocalFolderModal()
    await Promise.all([fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
  } catch (err) {
    localFolderFormError.value = err.response?.data?.error || 'Gagal menyimpan folder.'
  } finally {
    localFolderFormLoading.value = false
  }
}

function confirmDeleteLocalFolder(folder) {
  deletingLocalFolder.value = folder
  folderDeleteData.value = null
}

async function executeDeleteLocalFolder(force = false) {
  if (!deletingLocalFolder.value) return
  localFolderFormLoading.value = true
  try {
    const url = `${API}/tahapan/${deletingLocalFolder.value.tahapan_id}/folders/${deletingLocalFolder.value.id}${force ? '?force=1' : ''}`
    await axios.delete(url)
    showToast('Folder lokal dan isinya berhasil dihapus.', 'success')
    deletingLocalFolder.value = null
    folderDeleteData.value = null
    await Promise.all([fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
  } catch (err) {
    if (err.response?.status === 409 && err.response?.data?.needs_confirm) {
      folderDeleteData.value = err.response.data
    } else {
      showToast(err.response?.data?.error || 'Gagal menghapus folder.', 'error')
    }
  } finally {
    localFolderFormLoading.value = false
  }
}

function filterFilesByFolder(folder) {
  selectedLocalFolderFilter.value = folder.nama_folder
  const el = document.querySelector('.section-local-files')
  if (el) el.scrollIntoView({ behavior: 'smooth' })
}

function triggerFolderUpload(folder) {
  targetFolderUpload.value = folder
  if (folderFileInputRef.value) {
    folderFileInputRef.value.click()
  }
}

async function handleFolderUploadChange(event) {
  const files = event.target.files
  if (!files || files.length === 0 || !targetFolderUpload.value) return
  const folder = targetFolderUpload.value
  uploadingLocal.value = true
  showToast(`Mengunggah ${files.length} file ke folder "${folder.nama_folder}"...`, 'info')

  try {
    const formData = new FormData()
    formData.append('bidang_id', currentBidang.value.id)
    formData.append('tahapan_id', folder.tahapan_id)
    formData.append('folder_path', folder.nama_folder)
    for (const f of files) formData.append('files', f)

    await axios.post(`${API}/local-files/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    showToast(`${files.length} file berhasil diunggah ke folder "${folder.nama_folder}".`, 'success')
    event.target.value = ''
    targetFolderUpload.value = null
    await Promise.all([fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal mengunggah file.', 'error')
  } finally {
    uploadingLocal.value = false
  }
}

// ─── SALIN DARI GOOGLE DRIVE KE SERVER LOKAL ───────────────────────────────
function openImportGDriveModal(prefillTahapanId = null) {
  let defaultTahapan = ''
  if (typeof prefillTahapanId === 'string' && prefillTahapanId) {
    defaultTahapan = prefillTahapanId
  } else if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all' && selectedTahapanFilter.value !== 'umum') {
    defaultTahapan = selectedTahapanFilter.value
  } else if (tahapanList.value.length > 0) {
    defaultTahapan = tahapanList.value[0].id
  }
  importGDriveForm.value = { drive_url_or_id: '', tahapan_id: defaultTahapan, folder_name: '' }
  inspectedDriveInfo.value = null
  importError.value = ''
  showImportGDriveModal.value = true
}

function openImportForDriveLink(link) {
  openImportGDriveModal(link.tahapan_id)
  importGDriveForm.value.drive_url_or_id = link.drive_folder_url || link.drive_folder_id
  importGDriveForm.value.folder_name = link.nama_folder
  inspectDriveLink()
}

function closeImportGDriveModal() {
  if (importingGDrive.value) return
  showImportGDriveModal.value = false
  inspectedDriveInfo.value = null
  importError.value = ''
}

async function inspectDriveLink() {
  if (!importGDriveForm.value.drive_url_or_id) return
  inspectingDrive.value = true
  importError.value = ''
  inspectedDriveInfo.value = null
  try {
    const res = await axios.post(`${API}/gdrive-import/inspect`, {
      drive_url_or_id: importGDriveForm.value.drive_url_or_id
    })
    inspectedDriveInfo.value = res.data
    if (!importGDriveForm.value.folder_name && res.data.name) {
      importGDriveForm.value.folder_name = res.data.name
    }
  } catch (err) {
    importError.value = err.response?.data?.error || 'Gagal memeriksa tautan Google Drive.'
  } finally {
    inspectingDrive.value = false
  }
}

async function startImportGDrive() {
  if (!importGDriveForm.value.drive_url_or_id) {
    importError.value = 'URL atau ID Google Drive wajib diisi.'
    return
  }
  importingGDrive.value = true
  importError.value = ''

  try {
    const res = await axios.post(`${API}/gdrive-import/copy`, {
      drive_url_or_id: importGDriveForm.value.drive_url_or_id,
      bidang_id: currentBidang.value.id,
      tahapan_id: importGDriveForm.value.tahapan_id || undefined,
      folder_name: importGDriveForm.value.folder_name || undefined
    })

    const jobId = res.data.jobId
    showToast('Proses penyalinan file dari Google Drive sedang berjalan...', 'info')

    const pollInterval = setInterval(async () => {
      try {
        const jobRes = await axios.get(`${API}/gdrive-import/job/${jobId}`)
        const job = jobRes.data.job
        if (job.status === 'completed') {
          clearInterval(pollInterval)
          importingGDrive.value = false
          showToast(`Berhasil menyalin ${job.copiedFiles} file dari Google Drive ke server lokal!`, 'success')
          closeImportGDriveModal()
          await Promise.all([fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
        } else if (job.status === 'failed') {
          clearInterval(pollInterval)
          importingGDrive.value = false
          importError.value = job.error || 'Penyalinan gagal.'
        }
      } catch (pollErr) {
        clearInterval(pollInterval)
        importingGDrive.value = false
        importError.value = 'Gagal memantau proses penyalinan.'
      }
    }, 2000)

  } catch (err) {
    importingGDrive.value = false
    importError.value = err.response?.data?.error || 'Gagal memulai penyalinan dari Google Drive.'
  }
}

// Folder Modals
function openAddModal(prefillTahapanId = null) {
  editingLink.value = null
  let defaultTahapan = ''
  if (typeof prefillTahapanId === 'string' && prefillTahapanId) {
    defaultTahapan = prefillTahapanId
  } else if (selectedTahapanFilter.value && selectedTahapanFilter.value !== 'all' && selectedTahapanFilter.value !== 'umum') {
    defaultTahapan = selectedTahapanFilter.value
  }
  folderForm.value = { nama_folder: '', drive_folder_url: '', tahapan_id: defaultTahapan }
  formError.value = ''
  showFolderModal.value = true
}

function openEditModal(link) {
  editingLink.value = link
  folderForm.value = {
    nama_folder: link.nama_folder,
    drive_folder_url: link.drive_folder_url,
    tahapan_id: link.tahapan_id || ''
  }
  formError.value = ''
  showFolderModal.value = true
}

function closeFolderModal() {
  showFolderModal.value = false
  editingLink.value = null
  formError.value = ''
}

async function submitFolderForm() {
  formError.value = ''
  formLoading.value = true

  const url = folderForm.value.drive_folder_url
  if (url && !url.includes('drive.google.com')) {
    formError.value = 'URL harus berupa tautan Google Drive.'
    formLoading.value = false
    return
  }

  try {
    if (editingLink.value) {
      await axios.put(`${API}/drive-links/${editingLink.value.id}`, folderForm.value)
      showToast('Folder berhasil diperbarui.', 'success')
    } else {
      await axios.post(`${API}/drive-links`, {
        ...folderForm.value,
        bidang_id: currentBidang.value?.id,
      })
      showToast('Folder berhasil ditambahkan.', 'success')
    }
    closeFolderModal()
    await fetchDriveLinks()
  } catch (err) {
    formError.value = err.response?.data?.error || 'Gagal menyimpan folder.'
  } finally {
    formLoading.value = false
  }
}

function confirmDelete(link) {
  deletingLink.value = link
}

async function executeDelete() {
  formLoading.value = true
  try {
    await axios.delete(`${API}/drive-links/${deletingLink.value.id}`)
    showToast('Folder berhasil dihapus.', 'success')
    deletingLink.value = null
    await fetchDriveLinks()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal menghapus folder.', 'error')
  } finally {
    formLoading.value = false
  }
}

// File Explorer Modal (in-app navigation, breadcrumb)
function openFolderFiles(link) {
  selectedFolder.value = link
  explorerRootId.value = link.drive_folder_id
  explorerRootName.value = link.nama_folder
}

async function copyServiceAccountEmail() {
  try {
    await navigator.clipboard.writeText(serviceAccountEmail)
    copiedSa.value = true
    showToast('Email Service Account disalin.', 'success')
    setTimeout(() => { copiedSa.value = false }, 2500)
  } catch {
    showToast('Gagal menyalin email.', 'error')
  }
}

function getFileIconEmoji(mimeType) {
  if (mimeType?.includes('pdf')) return '📄'
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return '📊'
  if (mimeType?.includes('wordprocessing') || mimeType?.includes('word')) return '📝'
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return '📑'
  return '📁'
}

function getLocalFileEmoji(mimeType) {
  if (!mimeType) return '📎'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('image')) return '🖼️'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('wordprocessing') || mimeType.includes('word') || mimeType.includes('msword')) return '📝'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return '📦'
  if (mimeType.includes('video')) return '🎬'
  if (mimeType.includes('audio')) return '🎵'
  return '📎'
}

function isCompressible(mimeType, fileName) {
  if (!mimeType && !fileName) return false
  const name = (fileName || '').toLowerCase()
  const mime = (mimeType || '').toLowerCase()
  return mime.includes('image/') ||
    mime.includes('pdf') ||
    name.endsWith('.jpg') || name.endsWith('.jpeg') ||
    name.endsWith('.png') || name.endsWith('.pdf')
}

function formatSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ─── Local Files Functions ────────────────────────────────────────────────
async function fetchLocalFiles() {
  if (!currentBidang.value?.id) return
  loadingLocalFiles.value = true
  try {
    const res = await axios.get(`${API}/local-files`, {
      params: { bidang_id: currentBidang.value.id }
    })
    localFiles.value = res.data.files || []
  } catch (err) {
    showToast('Gagal memuat file lokal.', 'error')
  } finally {
    loadingLocalFiles.value = false
  }
}

async function handleUploadLocalFiles(event) {
  const files = event.target.files
  if (!files || files.length === 0) return
  if (!currentBidang.value?.id) return
  uploadingLocal.value = true
  try {
    const formData = new FormData()
    formData.append('bidang_id', currentBidang.value.id)
    for (const f of files) formData.append('files', f)
    await axios.post(`${API}/local-files/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    showToast(`${files.length} file berhasil diunggah.`, 'success')
    event.target.value = ''
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal mengunggah file.', 'error')
  } finally {
    uploadingLocal.value = false
  }
}

async function downloadLocalFile(lf) {
  extractingLocalId.value = lf.id
  try {
    const res = await axios.get(`${API}/local-files/${lf.id}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = lf.original_name
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal mengunduh file.', 'error')
  } finally {
    extractingLocalId.value = null
  }
}

async function downloadLocalZipBatch() {
  if (selectedLocalIds.value.length === 0) return
  zippingLocal.value = true
  try {
    const res = await axios.post(`${API}/local-files/zip-download`,
      { file_ids: selectedLocalIds.value },
      { responseType: 'blob' }
    )
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `arsip_lokal_${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    selectedLocalIds.value = []
    showToast('File ZIP berhasil diunduh.', 'success')
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal membuat file ZIP.', 'error')
  } finally {
    zippingLocal.value = false
  }
}

async function compressMediaSingle(lf) {
  compressingLocalId.value = lf.id
  try {
    const res = await axios.post(`${API}/local-files/${lf.id}/compress-media`)
    if (res.data.success) {
      showToast(`${lf.original_name}: dikompres -${res.data.percent_saved}%`, 'success')
    } else {
      showToast(res.data.message || 'Ukuran sudah optimal.', 'success')
    }
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal mengompresi file.', 'error')
  } finally {
    compressingLocalId.value = null
  }
}

async function compressMediaBatchAction() {
  if (selectedLocalIds.value.length === 0) return
  compressingBatch.value = true
  try {
    const res = await axios.post(`${API}/local-files/compress-media-batch`,
      { file_ids: selectedLocalIds.value }
    )
    const processed = res.data.processed || []
    const saved = processed.filter(p => p.compressed).length
    showToast(`Kompresi selesai: ${saved}/${processed.length} file berhasil dikompres.`, 'success')
    selectedLocalIds.value = []
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal kompresi batch.', 'error')
  } finally {
    compressingBatch.value = false
  }
}

async function restoreLocalFile(lf) {
  try {
    await axios.post(`${API}/local-files/${lf.id}/restore`)
    showToast('File berhasil dipulihkan ke aktif.', 'success')
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal memulihkan file.', 'error')
  }
}

async function togglePinLocalFile(lf) {
  try {
    const res = await axios.post(`${API}/local-files/${lf.id}/pin`)
    showToast(res.data.message || 'Pin diperbarui.', 'success')
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal mengubah pin.', 'error')
  }
}

async function deleteLocalFile(lf) {
  if (!confirm(`Hapus file "${lf.original_name}" secara permanen dari server?`)) return
  try {
    await axios.delete(`${API}/local-files/${lf.id}`)
    showToast('File lokal berhasil dihapus.', 'success')
    await fetchLocalFiles()
  } catch (err) {
    showToast(err.response?.data?.error || 'Gagal menghapus file.', 'error')
  }
}

function toggleSelectAllLocal(event) {
  if (event.target.checked) {
    selectedLocalIds.value = filteredLocalFiles.value.map(f => f.id)
  } else {
    selectedLocalIds.value = []
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function showToast(message, type = 'success') {
  const id = Date.now()
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 3200)
}

// Lifecycle
async function loadAllData() {
  await fetchBidangs()
  await Promise.all([fetchDriveLinks(), fetchTahapan(), fetchLocalFolders(), fetchLocalFiles()])
}

onMounted(async () => {
  await loadAllData()
})

onBeforeUnmount(() => {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }
})

watch(
  [flowContainerRef, loadingTahapan, canEdit],
  async ([el, loading, can]) => {
    if (el && !loading && can) {
      await nextTick()
      setupSortable()
    }
  },
  { flush: 'post' }
)

watch(() => [props.slug, props.bidangId, route.params.bidangId], async () => {
  selectedTahapanFilter.value = 'all'
  await loadAllData()
})
</script>

<style scoped>
/* =====================================================
   LAYOUT SESUAI WIREFRAME SEDERHANA
   ===================================================== */
.bidang-view {
  padding: 1.5rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Header: Judul & Nama Bidang */
.page-header {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.8rem;
}
.page-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}
.page-bidang-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin-top: 0.3rem;
}
.user-role-text {
  font-size: 0.8rem;
  color: var(--color-text-caption);
  margin-left: 0.3rem;
}

/* Section Utama */
.section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.2rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.section-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* =====================================================
   SECTION 1: TAHAPAN PROSES PERENCANAAN
   ===================================================== */
.flow-wrapper {
  overflow-x: auto;
  padding: 0.4rem 0.2rem 0.8rem;
}
.flow-diagram {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: min-content;
}
.flow-item {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.flow-box {
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px 12px;
  width: 175px;
  min-width: 175px;
  max-width: 175px;
  flex: 0 0 175px;
  height: 220px;
  min-height: 220px;
  max-height: 220px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  user-select: none;
  -webkit-user-select: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  transition: all var(--transition);
  cursor: pointer;
  position: relative;
}
.flow-box--editable {
  cursor: grab;
}
.flow-box--editable:active {
  cursor: grabbing;
}
.flow-box:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.06);
}
.flow-box--active {
  border-color: var(--color-primary) !important;
  background: #F0FDF9 !important;
  box-shadow: 0 0 0 3px rgba(91, 200, 168, 0.25), 0 4px 12px rgba(0,0,0,0.05) !important;
}

.sortable-ghost {
  opacity: 0.3 !important;
  border: 2px dashed var(--color-primary) !important;
  background: var(--color-primary-light) !important;
}

/* Aksi dalam kotak */
.flow-box-actions {
  width: 100%;
  height: 22px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
  flex-shrink: 0;
}
.flow-arrows-inline {
  display: flex;
  gap: 4px;
  width: 44px;
}
.btn-flow-nav {
  width: 20px;
  height: 20px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #F1F5F9;
  border: 1px solid #CBD5E1;
  border-radius: 4px;
  font-size: 0.65rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  line-height: 1;
}
.btn-flow-nav:hover:not(:disabled) {
  background: var(--color-primary-light);
  color: var(--color-primary-dark);
  border-color: var(--color-primary);
}
.btn-flow-nav--hidden {
  visibility: hidden !important;
  pointer-events: none !important;
}

.flow-crud-btns {
  display: flex;
  gap: 4px;
  width: 44px;
  justify-content: flex-end;
}
.btn-flow-tool {
  width: 20px;
  height: 20px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  opacity: 0.65;
  border-radius: 4px;
  transition: opacity 0.15s, background 0.15s;
}
.btn-flow-tool:hover {
  opacity: 1;
  background: #F1F5F9;
}
.btn-flow-tool.danger:hover {
  background: #FEE2E2;
}

.flow-box-icon {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  line-height: 1;
  margin: 2px auto 6px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.flow-box:hover .flow-box-icon,
.flow-box--active .flow-box-icon {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
}

.flow-box-label {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  flex-shrink: 0;
}
.flow-box-desc {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  margin: 4px 0;
  line-height: 1.35;
  height: 38px;
  min-height: 38px;
  max-height: 38px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 100%;
  text-align: center;
  flex-shrink: 0;
}
.flow-box-desc--empty {
  color: var(--color-text-caption);
  opacity: 0.5;
}

.flow-box-footer {
  margin-top: auto;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  border-top: 1px dashed var(--color-border);
  flex-shrink: 0;
  height: 26px;
}
.flow-box-step {
  font-size: 0.65rem;
  color: var(--color-primary-dark);
  font-weight: 700;
  background: var(--color-primary-light);
  padding: 2px 7px;
  border-radius: var(--radius-pill);
}
.flow-box-count {
  font-size: 0.68rem;
  color: var(--color-text-caption);
  font-weight: 500;
}

.flow-arrow {
  padding: 0 0.4rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.flow-item:last-child .flow-arrow {
  display: none !important;
}

/* Banner Filter Tahapan Aktif */
.tahapan-active-banner {
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  margin-bottom: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.tab-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.tab-icon {
  font-size: 1.5rem;
}
.tab-title {
  font-size: 0.92rem;
  color: #166534;
}
.tab-badge {
  font-size: 0.72rem;
  font-weight: 600;
  background: #DCFCE7;
  color: #15803D;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid #86EFAC;
}
.tab-subtitle {
  font-size: 0.75rem;
  color: #15803D;
  margin-top: 2px;
}
.tab-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* =====================================================
   SECTION 2: SEARCH BAR & FILTER TAHAPAN
   ===================================================== */
.search-filter-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.filter-select {
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: 0.85rem;
  background: var(--color-surface);
  color: var(--color-text-primary);
  outline: none;
  cursor: pointer;
}
.filter-select:focus {
  border-color: var(--color-primary);
}
.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-input-wrap .search-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--color-text-caption);
  pointer-events: none;
}
.search-input {
  padding: 0.45rem 0.85rem 0.45rem 2.2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: 0.85rem;
  width: 240px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  outline: none;
}
.search-input:focus {
  border-color: var(--color-primary);
}

/* Grid Folder */
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 1rem;
}

/* Tombol + Tambah di Bagian Bawah (Sesuai Sketsa) */
.bottom-action-area {
  margin-top: 1.4rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: center;
}

/* =====================================================
   MODAL & FORMS
   ===================================================== */
.modal-box--large {
  max-width: 600px;
}
.modal-header-btns {
  display: flex;
  align-items: center;
  gap: 6px;
}
.modal-desc {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.8rem;
}
.text-danger {
  color: var(--color-danger);
}
.form-select {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 0.88rem;
  outline: none;
}
.form-select:focus {
  border-color: var(--color-primary);
}

/* Service Account Info */
.sa-info-box {
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.8rem;
}
.sa-info-header {
  font-size: 0.78rem;
  font-weight: 700;
  color: #166534;
}
.sa-email-line {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #FFFFFF;
  border: 1px solid #CBD5E1;
  border-radius: 4px;
  padding: 3px 6px;
  margin-top: 4px;
}
.sa-email-line code {
  font-family: monospace;
  font-size: 0.72rem;
  color: #0F172A;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-copy {
  background: var(--color-primary-light);
  color: var(--color-primary-dark);
  border: 1px solid var(--color-primary);
  border-radius: 3px;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  cursor: pointer;
}

/* Drive Error */
.drive-error-container {
  background: #FFF1F2;
  border: 1px solid #FECDD3;
  border-radius: var(--radius-sm);
  padding: 0.85rem;
}
.drive-error-content strong {
  color: var(--color-danger);
  font-size: 0.88rem;
}
.drive-error-msg {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  white-space: pre-line;
  margin-top: 4px;
}

/* File list */
.file-list {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.3rem;
  border-bottom: 1px solid var(--color-border);
}
.file-item:last-child {
  border-bottom: none;
}
.file-icon-box {
  font-size: 1.25rem;
}
.file-info-col {
  flex: 1;
  min-width: 0;
}
.file-name {
  font-size: 0.85rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-action-btns {
  display: flex;
  gap: 4px;
}
.btn-xs {
  font-size: 0.72rem !important;
  padding: 0.25rem 0.6rem !important;
}

/* Icon picker */
.icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
}
.btn-icon-choice {
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: 4px;
  cursor: pointer;
  font-size: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn-icon-choice.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.empty-state {
  text-align: center;
  padding: 1.8rem 1rem;
  color: var(--color-text-caption);
  font-size: 0.88rem;
}
</style>
