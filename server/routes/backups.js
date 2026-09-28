const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const db = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const { getBackupStoragePath, ensureDirSync } = require('../services/storageService');
const { createFullBackup } = require('../services/backupService');
const { restartScheduler } = require('../services/schedulerService');

// GET /api/backups - list backup history
router.get('/', verifyToken, (req, res) => {
  const backups = db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
  res.json({ backups });
});

// POST /api/backups/create - manual trigger backup (superadmin only)
router.post('/create', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const backup = await createFullBackup(req.user.nama, 'manual');
    res.status(201).json({ message: 'Backup berhasil dibuat!', backup });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat backup: ' + err.message });
  }
});

// GET /api/backups/:id/download - download full backup archive (superadmin only)
router.get('/:id/download', verifyToken, requireSuperAdmin, (req, res) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup tidak ditemukan.' });

  const fullPath = path.join(getBackupStoragePath(), backup.filename);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File backup fisik tidak ditemukan di server.' });
  }

  res.download(fullPath, backup.filename);
});

// GET /api/backups/:id/tree - lihat isi pohon direktori backup (admin & user sesuai hak)
router.get('/:id/tree', verifyToken, async (req, res) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup tidak ditemukan.' });

  const fullPath = path.join(getBackupStoragePath(), backup.filename);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File backup fisik tidak ditemukan.' });
  }

  try {
    const directory = await unzipper.Open.file(fullPath);
    let items = directory.files.map(f => ({
      path: f.path,
      size: f.uncompressedSize,
      type: f.type, // 'File' / 'Directory'
    }));

    // Jika admin bidang, batasi hanya melihat folder bidangnya atau file miliknya
    if (req.user.role === 'ADMIN_BIDANG') {
      const userBidang = db.prepare('SELECT nama_bidang FROM bidang WHERE id = ?').get(req.user.bidang_id);
      const safeBidangName = userBidang ? userBidang.nama_bidang.replace(/[/\\?%*:|"<>]/g, '_').toLowerCase() : '';
      items = items.filter(i => {
        const p = i.path.toLowerCase();
        return p.includes(safeBidangName) || p.startsWith('database/');
      });
    }

    res.json({ files: items });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca isi backup: ' + err.message });
  }
});

// POST /api/backups/:id/restore-partial - restore sebagian file/folder bidang miliknya
router.post('/:id/restore-partial', verifyToken, async (req, res) => {
  const { file_paths, overwrite } = req.body;
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup tidak ditemukan.' });

  if (!Array.isArray(file_paths) || file_paths.length === 0) {
    return res.status(400).json({ error: 'Daftar file_paths tidak boleh kosong.' });
  }

  const fullPath = path.join(getBackupStoragePath(), backup.filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File backup fisik tidak ada.' });

  try {
    const zip = await unzipper.Open.file(fullPath);
    let restoredCount = 0;

    for (const targetPath of file_paths) {
      const entry = zip.files.find(f => f.path === targetPath);
      if (!entry) continue;

      // Restorasi ke root aplikasi
      let dest = path.resolve(process.cwd(), targetPath);
      if (!overwrite && fs.existsSync(dest)) {
        const ext = path.extname(dest);
        const base = path.basename(dest, ext);
        dest = path.join(path.dirname(dest), `${base}_salinan_${Date.now()}${ext}`);
      }

      ensureDirSync(path.dirname(dest));
      await new Promise((resolve, reject) => {
        entry.stream()
          .pipe(fs.createWriteStream(dest))
          .on('finish', resolve)
          .on('error', reject);
      });
      restoredCount++;
    }

    res.json({ message: `Berhasil memulihkan ${restoredCount} item dari backup.` });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memulihkan sebagian file: ' + err.message });
  }
});

// POST /api/backups/:id/restore-full - restore penuh (superadmin only, dengan safety backup otomatis)
router.post('/:id/restore-full', verifyToken, requireSuperAdmin, async (req, res) => {
  const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!backup) return res.status(404).json({ error: 'Backup tidak ditemukan.' });

  const fullPath = path.join(getBackupStoragePath(), backup.filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File backup fisik tidak ditemukan.' });

  try {
    // 1. Buat safety backup otomatis sebelum restore penuh
    console.log('[Restore Penuh] Membuat safety backup otomatis sebelum restore...');
    await createFullBackup(req.user.nama, 'safety_pre_restore');

    // 2. Ekstrak backup ke direktori tujuan
    const zip = await unzipper.Open.file(fullPath);
    await zip.extract({ path: process.cwd() });

    res.json({ message: 'Restore sistem penuh berhasil dilakukan. Safety backup telah disimpan.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menjalankan restore penuh: ' + err.message });
  }
});

// GET /api/backups/settings - ambil konfigurasi arsip & backup
router.get('/settings', verifyToken, requireSuperAdmin, (req, res) => {
  const settingsRows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN (
      'archive_lifecycle_days', 'archive_lifecycle_time', 'archive_lifecycle_enabled',
      'backup_time', 'backup_enabled', 'backup_retention_days', 'backup_retention_weeks'
    )
  `).all();

  const settings = {};
  for (const s of settingsRows) {
    settings[s.key] = s.value;
  }
  res.json({ settings });
});

// POST /api/backups/settings - update konfigurasi arsip & backup
router.post('/settings', verifyToken, requireSuperAdmin, (req, res) => {
  const payload = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))');

  for (const [key, val] of Object.entries(payload)) {
    stmt.run(key, String(val));
  }

  // Restart scheduler cron dengan jadwal baru
  restartScheduler();

  res.json({ message: 'Pengaturan arsip dan backup berhasil disimpan.' });
});

module.exports = router;
