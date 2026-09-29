<template>
  <div class="local-folder-card card" @click="$emit('click-folder', folder)">
    <!-- Header Card -->
    <div class="lfc-header">
      <div class="lfc-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>

      <!-- Actions -->
      <div v-if="canEdit" class="lfc-actions" @click.stop>
        <button class="btn-icon" title="Upload file ke folder ini" @click.stop="$emit('upload-files', folder)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
        <button class="btn-icon" title="Ubah nama folder" @click.stop="$emit('edit', folder)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon danger" title="Hapus folder" @click.stop="$emit('delete', folder)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Body Card -->
    <div class="lfc-body">
      <div class="lfc-name" :title="folder.nama_folder">{{ folder.nama_folder }}</div>
      <div class="lfc-meta">
        <span class="tahapan-tag">
          {{ folder.nama_tahapan || 'Tahapan' }}
        </span>
        <span class="file-count-badge">
          {{ folder.file_count || 0 }} file
        </span>
      </div>
    </div>

    <!-- Footer Card -->
    <div class="lfc-footer">
      <div style="display:flex;align-items:center;gap:0.4rem;">
        <span class="badge badge-local">Penyimpanan Lokal</span>
        <span v-if="folder.dibuat_oleh" class="caption">Oleh {{ folder.dibuat_oleh }}</span>
      </div>
      <div>
        <button class="btn-link" @click.stop="$emit('click-folder', folder)" title="Buka dan filter dokumen folder ini">
          Buka &rarr;
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  folder: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
})
defineEmits(['click-folder', 'upload-files', 'edit', 'delete'])
</script>

<style scoped>
.local-folder-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: all var(--transition);
}
.local-folder-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  transform: translateY(-2px);
}
.lfc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 0.9rem 0.4rem;
}
.lfc-icon-wrap {
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  padding: 0.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lfc-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.lfc-body {
  padding: 0.4rem 0.9rem 0.75rem;
  flex: 1;
}
.lfc-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
  margin-bottom: 0.35rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lfc-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.tahapan-tag {
  font-size: 0.72rem;
  padding: 0.15rem 0.45rem;
  background: #F0FDF4;
  color: #166534;
  border: 1px solid #BBF7D0;
  border-radius: var(--radius-sm);
  font-weight: 500;
}
.file-count-badge {
  font-size: 0.72rem;
  color: var(--color-text-caption);
}
.lfc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.9rem;
  border-top: 1px solid var(--color-border-subtle, #F1F5F9);
  background: var(--color-bg-subtle, #F8FAFC);
  font-size: 0.75rem;
}
.badge-local {
  background: #ECFDF5;
  color: #065F46;
  border: 1px solid #A7F3D0;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
}
.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}
.btn-link:hover {
  text-decoration: underline;
}
</style>
