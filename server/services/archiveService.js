const fs = require('fs');
const path = require('path');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const {
  getHotStoragePath,
  getArchiveStoragePath,
  calculateChecksum,
  zipSingleFile,
  ensureDirSync,
  compressMediaFile,
} = require('./storageService');

/**
 * Arsipkan 1 file lokal:
 * Langkah:
 * 1. Cek keberadaan file di hot storage
 * 2. Kompres ukuran (jika gambar JPG/PNG atau PDF)
 * 3. Zip per file ke folder arsip sesuai Tahun/Modul/Bidang
 * 4. Verifikasi ukuran (> 0) & Checksum SHA-256
 * 5. Update database: location='archive', archive_path, checksum, compressed=1, archived_at
 * 6. Hapus file asli di hot storage HANYA jika verifikasi sukses
 * 7. Jika gagal: file asli JANGAN dihapus, catat error, retry otomatis, notifikasi superadmin jika berulang
 */
async function archiveSingleFile(fileRow) {
  const hotPath = path.resolve(getHotStoragePath(), fileRow.hot_path);
  if (!fs.existsSync(hotPath)) {
    const errorMsg = `File asli tidak ditemukan di hot storage: ${fileRow.hot_path}`;
    recordArchiveFailure(fileRow, errorMsg);
    throw new Error(errorMsg);
  }

  try {
    // 1. Kompres ukuran jika berupa gambar (JPG/PNG) atau PDF
    let originalSize = fileRow.original_size || fileRow.size;
    let currentHotSize = fs.statSync(hotPath).size;

    const compResult = await compressMediaFile(hotPath, fileRow.mime_type);
    if (compResult.compressed) {
      currentHotSize = compResult.newSize;
    }

    // Cari metadata tahun & modul (bidang)
    const bidang = db.prepare('SELECT b.nama_bidang, t.nama AS tahun_nama FROM bidang b LEFT JOIN tahun t ON b.tahun_id = t.id WHERE b.id = ?').get(fileRow.bidang_id);
    const tahunFolder = (bidang && bidang.tahun_nama) ? `Tahun_${bidang.tahun_nama}` : 'Tahun_Umum';
    const bidangFolder = (bidang && bidang.nama_bidang) ? bidang.nama_bidang.replace(/[/\\?%*:|"<>]/g, '_') : 'Bidang_Umum';

    const relativeArchiveDir = path.join(tahunFolder, bidangFolder);
    const archiveDir = path.join(getArchiveStoragePath(), relativeArchiveDir);
    ensureDirSync(archiveDir);

    const archiveFileName = `${fileRow.id}_${fileRow.stored_name}.zip`;
    const fullArchiveFilePath = path.join(archiveDir, archiveFileName);
    const relativeArchiveFilePath = path.join(relativeArchiveDir, archiveFileName);

    // 2. Zip file lokal
    await zipSingleFile(hotPath, fullArchiveFilePath, fileRow.original_name);

    // 3. Verifikasi ukuran file arsip
    const archiveStat = fs.statSync(fullArchiveFilePath);
    if (archiveStat.size <= 0) {
      if (fs.existsSync(fullArchiveFilePath)) fs.unlinkSync(fullArchiveFilePath);
      throw new Error('Verifikasi gagal: Ukuran file arsip 0 byte.');
    }

    // 4. Verifikasi checksum SHA-256
    const checksum = await calculateChecksum(fullArchiveFilePath);
    if (!checksum) {
      if (fs.existsSync(fullArchiveFilePath)) fs.unlinkSync(fullArchiveFilePath);
      throw new Error('Verifikasi gagal: Checksum SHA-256 tidak valid.');
    }

    // 5. Update database
    db.prepare(`
      UPDATE local_files
      SET location = 'archive',
          archive_path = ?,
          size = ?,
          original_size = ?,
          checksum = ?,
          compressed = 1,
          archived_at = (datetime('now')),
          updated_at = (datetime('now'))
      WHERE id = ?
    `).run(relativeArchiveFilePath, archiveStat.size, originalSize, checksum, fileRow.id);

    // 6. Hapus file asli di hot storage HANYA setelah verifikasi berhasil
    try {
      fs.unlinkSync(hotPath);
    } catch (err) {
      console.warn(`Peringatan: Gagal menghapus file hot ${hotPath}:`, err.message);
    }

    // Log activity
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      fileRow.user_id || 'system',
      fileRow.uploaded_by || 'Sistem Arsip',
      'ARSIP_FILE',
      `Arsip berhasil: "${fileRow.original_name}" (asli: ${originalSize}B -> arsip: ${archiveStat.size}B, sha256: ${checksum.slice(0, 8)})`
    );

    return {
      success: true,
      archivePath: relativeArchiveFilePath,
      size: archiveStat.size,
      originalSize,
      checksum
    };
  } catch (err) {
    // Penanganan kegagalan: File asli TIDAK dihapus
    recordArchiveFailure(fileRow, err.message);
    throw err;
  }
}

// Catat kegagalan arsip, retry count, dan notifikasi superadmin jika berulang
function recordArchiveFailure(fileRow, errorMessage) {
  try {
    const currentRetries = (fileRow.archive_retry_count || 0) + 1;

    // Catat log kegagalan
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'system',
      'Sistem Arsip',
      'ARSIP_GAGAL',
      `Gagal mengarsipkan file "${fileRow.original_name}": ${errorMessage} (Percobaan ke-${currentRetries})`
    );

    // Jika gagal berulang (>= 3 kali), buat log peringatan penting untuk Super Admin
    if (currentRetries >= 3) {
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        'system',
        'Peringatan Sistem',
        'PERINGATAN_SUPERADMIN',
        `⚠️ PERINGATAN: File "${fileRow.original_name}" gagal diarsipkan sebanyak ${currentRetries} kali! Error: ${errorMessage}. File asli tetap aman di Hot Storage.`
      );
    }
  } catch (e) {
    console.error('Gagal mencatat log kegagalan arsip:', e.message);
  }
}

/**
 * Jalankan Lifecycle Rule otomatis:
 * - File lokal berlokasi 'hot'
 * - Tidak di-pin (pinned = 0)
 * - Umur file melebihi threshold hari (default 30 hari atau dari settings)
 */
async function runArchiveLifecycle() {
  const settingEnabled = db.prepare("SELECT value FROM settings WHERE key = 'archive_lifecycle_enabled'").get();
  if (settingEnabled && settingEnabled.value === '0') {
    return { skipped: true, reason: 'Lifecycle dinonaktifkan di pengaturan' };
  }

  const settingDays = db.prepare("SELECT value FROM settings WHERE key = 'archive_lifecycle_days'").get();
  const thresholdDays = parseInt(settingDays?.value || process.env.LIFECYCLE_DAYS_THRESHOLD || '30', 10);

  // Ambil kandidat file:
  // created_at <= datetime('now', '-X days')
  const candidates = db.prepare(`
    SELECT * FROM local_files
    WHERE location = 'hot'
      AND pinned = 0
      AND created_at <= datetime('now', '-' || ? || ' days')
  `).all(thresholdDays);

  const results = {
    total: candidates.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  for (const f of candidates) {
    let success = false;
    let attempts = 0;
    const maxAttempts = 2; // Auto-retry 1 kali

    while (!success && attempts < maxAttempts) {
      attempts++;
      try {
        await archiveSingleFile(f);
        success = true;
        results.success++;
      } catch (err) {
        if (attempts >= maxAttempts) {
          results.failed++;
          results.errors.push({ id: f.id, name: f.original_name, error: err.message });
          console.error(`[Lifecycle] Gagal arsipkan file ${f.original_name} setelah ${attempts} percobaan:`, err.message);
        }
      }
    }
  }

  return results;
}

/**
 * Arsipkan seluruh file pada tahun anggaran tertentu
 */
async function archiveTahun(tahunId) {
  const candidates = db.prepare(`
    SELECT f.* FROM local_files f
    WHERE f.tahun_id = ?
      AND f.location = 'hot'
      AND f.pinned = 0
  `).all(tahunId);

  const results = { total: candidates.length, success: 0, failed: 0, errors: [] };
  for (const f of candidates) {
    try {
      await archiveSingleFile(f);
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push({ id: f.id, name: f.original_name, error: err.message });
    }
  }
  return results;
}

module.exports = {
  archiveSingleFile,
  runArchiveLifecycle,
  archiveTahun,
};
