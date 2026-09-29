const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const {
  getHotStoragePath,
  getArchiveStoragePath,
  getBackupStoragePath,
  getDirectorySize,
  getDiskCapacity,
} = require('../services/storageService');
const { runArchiveLifecycle, archiveTahun } = require('../services/archiveService');

// GET /api/archive/disk-usage - kapasitas storage lokal (hot, archive, backup)
router.get('/disk-usage', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const hotStat = getDirectorySize(getHotStoragePath());
    const archiveStat = getDirectorySize(getArchiveStoragePath());
    const backupStat = getDirectorySize(getBackupStoragePath());

    const hotDisk = getDiskCapacity(getHotStoragePath());
    const archiveDisk = getDiskCapacity(getArchiveStoragePath());

    const dbFileStats = (await pool.query('SELECT COUNT(*) as count, SUM(size) as total_size FROM local_files WHERE location = $1', ['hot'])).rows[0];
    const dbArchiveStats = (await pool.query('SELECT COUNT(*) as count, SUM(size) as total_size FROM local_files WHERE location = $1', ['archive'])).rows[0];

    res.json({
      storage: {
        hot: {
          path: getHotStoragePath(),
          bytes: hotStat.totalBytes,
          files: hotStat.fileCount,
          db_count: parseInt(dbFileStats.count) || 0,
          db_bytes: parseInt(dbFileStats.total_size) || 0,
          disk_total: hotDisk.totalBytes,
          disk_free: hotDisk.freeBytes,
          disk_used_percent: hotDisk.usedPercent,
          warning: hotDisk.warning,
        },
        archive: {
          path: getArchiveStoragePath(),
          bytes: archiveStat.totalBytes,
          files: archiveStat.fileCount,
          db_count: parseInt(dbArchiveStats.count) || 0,
          db_bytes: parseInt(dbArchiveStats.total_size) || 0,
          disk_total: archiveDisk.totalBytes,
          disk_free: archiveDisk.freeBytes,
          disk_used_percent: archiveDisk.usedPercent,
          warning: archiveDisk.warning,
        },
        backup: {
          path: getBackupStoragePath(),
          bytes: backupStat.totalBytes,
          files: backupStat.fileCount,
        }
      },
      disk_warning: hotDisk.warning || archiveDisk.warning || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/archive/run-lifecycle - trigger manual lifecycle archiving
router.post('/run-lifecycle', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const results = await runArchiveLifecycle();
    res.json({ message: 'Lifecycle rule arsip selesai dijalankan.', results });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menjalankan lifecycle rule: ' + err.message });
  }
});

// POST /api/archive/archive-tahun/:tahunId - arsipkan seluruh file pada tahun tertentu
router.post('/archive-tahun/:tahunId', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const results = await archiveTahun(req.params.tahunId);
    res.json({ message: `Arsip tahun berhasil diproses. Sukses: ${results.success}, Gagal: ${results.failed}`, results });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengarsipkan tahun: ' + err.message });
  }
});

module.exports = router;
