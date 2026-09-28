const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const unzipper = require('unzipper');
const db = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const {
  getHotStoragePath,
  getArchiveStoragePath,
  getCacheStoragePath,
  ensureDirSync,
  zipFilesStream,
  calculateChecksum,
  compressMediaFile,
} = require('../services/storageService');
const { archiveSingleFile } = require('../services/archiveService');

// Multer storage ke disk temporary / hot storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const hotBase = getHotStoragePath();
    const tempDir = path.join(hotBase, '_temp_uploads');
    ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 } // 300MB
});

// GET /api/local-files - list file lokal
router.get('/', verifyToken, (req, res) => {
  const { bidang_id, tahapan_id, search, location } = req.query;
  let query = `
    SELECT f.*, b.nama_bidang, t.label AS nama_tahapan, th.nama AS tahun_nama
    FROM local_files f
    JOIN bidang b ON f.bidang_id = b.id
    LEFT JOIN tahapan t ON f.tahapan_id = t.id
    LEFT JOIN tahun th ON f.tahun_id = th.id
  `;
  const params = [];
  const where = [];

  // Hak akses: admin bidang hanya bisa lihat bidangnya jika bukan superadmin
  if (req.user.role === 'ADMIN_BIDANG') {
    where.push('f.bidang_id = ?');
    params.push(req.user.bidang_id);
  } else if (bidang_id) {
    where.push('f.bidang_id = ?');
    params.push(bidang_id);
  }

  if (tahapan_id) {
    if (tahapan_id === 'umum') {
      where.push('f.tahapan_id IS NULL');
    } else if (tahapan_id !== 'all') {
      where.push('f.tahapan_id = ?');
      params.push(tahapan_id);
    }
  }

  if (location && ['hot', 'archive'].includes(location)) {
    where.push('f.location = ?');
    params.push(location);
  }

  if (search) {
    where.push('(f.original_name LIKE ? OR b.nama_bidang LIKE ? OR t.label LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (where.length > 0) {
    query += ' WHERE ' + where.join(' AND ');
  }

  query += ' ORDER BY f.created_at DESC';

  const files = db.prepare(query).all(...params);
  res.json({ files });
});

// POST /api/local-files/upload - upload file ke hot storage
router.post('/upload', verifyToken, upload.array('files', 10), async (req, res) => {
  const { bidang_id, tahapan_id, folder_path } = req.body;

  if (!bidang_id) {
    return res.status(400).json({ error: 'bidang_id wajib diisi.' });
  }

  // Hak akses bidang
  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== bidang_id) {
    return res.status(403).json({ error: 'Anda hanya bisa mengupload ke bidang Anda sendiri.' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  }

  const bidang = db.prepare('SELECT b.*, t.id AS tid, t.nama AS tahun_nama FROM bidang b LEFT JOIN tahun t ON b.tahun_id = t.id WHERE b.id = ?').get(bidang_id);
  if (!bidang) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

  const tahunFolder = bidang.tahun_nama ? `Tahun_${bidang.tahun_nama}` : 'Tahun_Umum';
  const bidangFolder = bidang.nama_bidang.replace(/[/\\?%*:|"<>]/g, '_');
  const targetSubdir = path.join(tahunFolder, bidangFolder, (folder_path || '').replace(/\.\./g, ''));
  const targetDir = path.join(getHotStoragePath(), targetSubdir);
  ensureDirSync(targetDir);

  const inserted = [];

  for (const f of req.files) {
    const finalStoredName = `${Date.now()}_${f.originalname.replace(/[/\\?%*:|"<>]/g, '_')}`;
    const destPath = path.join(targetDir, finalStoredName);
    fs.renameSync(f.path, destPath);

    const relHotPath = path.join(targetSubdir, finalStoredName);
    const checksum = await calculateChecksum(destPath);
    const id = 'loc-' + uuidv4().slice(0, 8);

    db.prepare(`
      INSERT INTO local_files (
        id, tahun_id, bidang_id, tahapan_id, folder_path,
        original_name, stored_name, mime_type, size, original_size,
        location, hot_path, checksum, compressed, pinned, uploaded_by, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'hot', ?, ?, 0, 0, ?, ?)
    `).run(
      id, bidang.tid || null, bidang.id, tahapan_id || null, folder_path || '',
      f.originalname, finalStoredName, f.mimetype, f.size, f.size,
      relHotPath, checksum, req.user.nama, req.user.id
    );

    inserted.push({ id, original_name: f.originalname, size: f.size, location: 'hot' });
  }

  // Log activity
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    uuidv4(), req.user.id, req.user.nama, 'UPLOAD_LOCAL_FILE',
    `Upload ${inserted.length} file ke ${bidang.nama_bidang}`
  );

  res.status(201).json({ message: 'File berhasil diunggah.', files: inserted });
});

// GET /api/local-files/:id/download - download file (hot / extract dari archive)
router.get('/:id/download', verifyToken, async (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  // Hak akses bidang
  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk file ini.' });
  }

  if (file.location === 'hot') {
    const fullPath = path.resolve(getHotStoragePath(), file.hot_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File fisik tidak ditemukan di server.' });
    }
    return res.download(fullPath, file.original_name);
  }

  // File di Archive (Cold Storage): Ekstrak ke Cache sementara
  if (file.location === 'archive') {
    const fullArchiveFile = path.resolve(getArchiveStoragePath(), file.archive_path);
    if (!fs.existsSync(fullArchiveFile)) {
      return res.status(404).json({ error: 'File arsip tidak ditemukan di cold storage.' });
    }

    try {
      const cacheDir = path.join(getCacheStoragePath(), file.id);
      ensureDirSync(cacheDir);

      const zip = await unzipper.Open.file(fullArchiveFile);
      const extractedFile = zip.files.find(f => f.path === file.original_name) || zip.files[0];

      if (!extractedFile) {
        return res.status(500).json({ error: 'File tidak ditemukan di dalam paket arsip zip.' });
      }

      const cachedFilePath = path.join(cacheDir, file.original_name);
      await new Promise((resolve, reject) => {
        extractedFile.stream()
          .pipe(fs.createWriteStream(cachedFilePath))
          .on('finish', resolve)
          .on('error', reject);
      });

      return res.download(cachedFilePath, file.original_name);
    } catch (err) {
      console.error('Ekstrak arsip error:', err);
      return res.status(500).json({ error: 'Gagal mengekstrak file dari arsip: ' + err.message });
    }
  }

  res.status(400).json({ error: 'Lokasi file tidak valid.' });
});

// POST /api/local-files/zip-download - multi-select kompres & download ZIP
router.post('/zip-download', verifyToken, async (req, res) => {
  const { file_ids } = req.body;
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: 'Daftar file_ids wajib berupa array tidak kosong.' });
  }

  const placeholders = file_ids.map(() => '?').join(',');
  let query = `SELECT * FROM local_files WHERE id IN (${placeholders})`;
  const params = [...file_ids];

  if (req.user.role === 'ADMIN_BIDANG') {
    query += ' AND bidang_id = ?';
    params.push(req.user.bidang_id);
  }

  const files = db.prepare(query).all(...params);
  if (files.length === 0) {
    return res.status(404).json({ error: 'Tidak ada file lokal yang valid atau berhak diakses.' });
  }

  const itemsToZip = [];

  for (const f of files) {
    if (f.location === 'hot') {
      const fullPath = path.resolve(getHotStoragePath(), f.hot_path);
      if (fs.existsSync(fullPath)) {
        const folder = f.folder_path ? `${f.folder_path}/` : '';
        itemsToZip.push({ filePath: fullPath, zipPath: `${folder}${f.original_name}` });
      }
    } else if (f.location === 'archive') {
      // Ekstrak sementara ke cache
      const fullArchiveFile = path.resolve(getArchiveStoragePath(), f.archive_path);
      if (fs.existsSync(fullArchiveFile)) {
        try {
          const cacheDir = path.join(getCacheStoragePath(), f.id);
          ensureDirSync(cacheDir);
          const zip = await unzipper.Open.file(fullArchiveFile);
          const extracted = zip.files.find(item => item.path === f.original_name) || zip.files[0];
          if (extracted) {
            const tempPath = path.join(cacheDir, f.original_name);
            await new Promise((resolve, reject) => {
              extracted.stream()
                .pipe(fs.createWriteStream(tempPath))
                .on('finish', resolve)
                .on('error', reject);
            });
            const folder = f.folder_path ? `${f.folder_path}/` : '';
            itemsToZip.push({ filePath: tempPath, zipPath: `${folder}${f.original_name}` });
          }
        } catch (_) {}
      }
    }
  }

  if (itemsToZip.length === 0) {
    return res.status(404).json({ error: 'Semua file fisik terpilih tidak ditemukan di server.' });
  }

  const now = new Date();
  const zipName = `unduhan_arsip_${now.getFullYear()}${now.getMonth()+1}${now.getDate()}_${now.getHours()}${now.getMinutes()}.zip`;

  // Log activity
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    uuidv4(), req.user.id, req.user.nama, 'KOMPRES_ZIP_DOWNLOAD',
    `Download ZIP multi-file (${itemsToZip.length} file)`
  );

  zipFilesStream(itemsToZip, res, zipName);
});

// POST /api/local-files/:id/compress-media - kompresi fisik ukuran file (gambar JPG/PNG atau PDF)
router.post('/:id/compress-media', verifyToken, async (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses.' });
  }

  if (file.location !== 'hot') {
    return res.status(400).json({ error: 'Hanya file aktif di Hot Storage yang dapat dikompresi ukurannya.' });
  }

  const fullPath = path.resolve(getHotStoragePath(), file.hot_path);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan di server.' });
  }

  try {
    const result = await compressMediaFile(fullPath, file.mime_type);
    if (result.compressed) {
      const checksum = await calculateChecksum(fullPath);
      const origSize = file.original_size || result.originalSize;
      db.prepare(`
        UPDATE local_files
        SET size = ?, original_size = ?, checksum = ?, compressed = 1, updated_at = (datetime('now'))
        WHERE id = ?
      `).run(result.newSize, origSize, checksum, file.id);

      db.prepare(`
        INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        uuidv4(), req.user.id, req.user.nama, 'KOMPRES_FILE',
        `Kompres ukuran "${file.original_name}": ${result.originalSize}B -> ${result.newSize}B (-${result.percentSaved}%)`
      );

      return res.json({
        success: true,
        message: `File berhasil dikompresi (-${result.percentSaved}%).`,
        original_size: result.originalSize,
        new_size: result.newSize,
        saved_bytes: result.savedBytes,
        percent_saved: result.percentSaved,
      });
    } else {
      return res.json({
        success: false,
        message: result.reason || 'Ukuran file sudah optimal.',
        original_size: result.originalSize,
        new_size: result.newSize,
        saved_bytes: 0,
        percent_saved: 0,
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengompresi file: ' + err.message });
  }
});

// POST /api/local-files/compress-media-batch - kompresi fisik multi-file sekaligus
router.post('/compress-media-batch', verifyToken, async (req, res) => {
  const { file_ids } = req.body;
  if (!Array.isArray(file_ids) || file_ids.length === 0) {
    return res.status(400).json({ error: 'Daftar file_ids wajib berupa array.' });
  }

  const placeholders = file_ids.map(() => '?').join(',');
  let query = `SELECT * FROM local_files WHERE id IN (${placeholders}) AND location = 'hot'`;
  const params = [...file_ids];

  if (req.user.role === 'ADMIN_BIDANG') {
    query += ' AND bidang_id = ?';
    params.push(req.user.bidang_id);
  }

  const files = db.prepare(query).all(...params);
  const results = [];

  for (const file of files) {
    const fullPath = path.resolve(getHotStoragePath(), file.hot_path);
    if (!fs.existsSync(fullPath)) continue;

    const r = await compressMediaFile(fullPath, file.mime_type);
    if (r.compressed) {
      const checksum = await calculateChecksum(fullPath);
      const origSize = file.original_size || r.originalSize;
      db.prepare(`
        UPDATE local_files
        SET size = ?, original_size = ?, checksum = ?, compressed = 1, updated_at = (datetime('now'))
        WHERE id = ?
      `).run(r.newSize, origSize, checksum, file.id);
    }
    results.push({
      id: file.id,
      name: file.original_name,
      compressed: r.compressed,
      before: r.originalSize,
      after: r.newSize,
      saved: r.savedBytes,
      percent: r.percentSaved,
    });
  }

  res.json({
    message: `Selesai memproses ${results.length} file.`,
    processed: results,
  });
});

// POST /api/local-files/:id/restore - pulihkan file arsip ke hot storage
router.post('/:id/restore', verifyToken, async (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses.' });
  }

  if (file.location === 'hot') {
    return res.json({ message: 'File sudah berstatus aktif (hot).' });
  }

  const fullArchiveFile = path.resolve(getArchiveStoragePath(), file.archive_path);
  if (!fs.existsSync(fullArchiveFile)) {
    return res.status(404).json({ error: 'File paket arsip tidak ditemukan.' });
  }

  try {
    const bidang = db.prepare('SELECT b.*, t.nama AS tahun_nama FROM bidang b LEFT JOIN tahun t ON b.tahun_id = t.id WHERE b.id = ?').get(file.bidang_id);
    const tahunFolder = bidang?.tahun_nama ? `Tahun_${bidang.tahun_nama}` : 'Tahun_Umum';
    const bidangFolder = (bidang?.nama_bidang || 'Umum').replace(/[/\\?%*:|"<>]/g, '_');
    const targetSubdir = path.join(tahunFolder, bidangFolder, (file.folder_path || '').replace(/\.\./g, ''));
    const targetDir = path.join(getHotStoragePath(), targetSubdir);
    ensureDirSync(targetDir);

    const restoredFileName = `${Date.now()}_${file.original_name.replace(/[/\\?%*:|"<>]/g, '_')}`;
    const restoredFilePath = path.join(targetDir, restoredFileName);

    const zip = await unzipper.Open.file(fullArchiveFile);
    const entry = zip.files.find(item => item.path === file.original_name) || zip.files[0];
    if (!entry) throw new Error('File tidak ditemukan dalam zip.');

    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(restoredFilePath))
        .on('finish', resolve)
        .on('error', reject);
    });

    const stat = fs.statSync(restoredFilePath);
    const checksum = await calculateChecksum(restoredFilePath);
    const relHotPath = path.join(targetSubdir, restoredFileName);

    // Hapus file arsip zip lama
    try { fs.unlinkSync(fullArchiveFile); } catch (_) {}

    // Update DB: reset umur file (created_at = now)
    db.prepare(`
      UPDATE local_files
      SET location = 'hot',
          hot_path = ?,
          archive_path = NULL,
          size = ?,
          checksum = ?,
          compressed = 0,
          archived_at = NULL,
          created_at = (datetime('now')),
          updated_at = (datetime('now'))
      WHERE id = ?
    `).run(relHotPath, stat.size, checksum, file.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      uuidv4(), req.user.id, req.user.nama, 'PULIHKAN_FILE',
      `Pulihkan file "${file.original_name}" ke aktif (hot)`
    );

    res.json({ message: 'File berhasil dipulihkan ke status aktif (Hot).' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memulihkan file: ' + err.message });
  }
});

// POST /api/local-files/:id/pin - toggle pin "Jangan arsipkan"
router.post('/:id/pin', verifyToken, (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses.' });
  }

  const newPin = file.pinned ? 0 : 1;
  db.prepare('UPDATE local_files SET pinned = ?, updated_at = (datetime("now")) WHERE id = ?').run(newPin, file.id);

  res.json({ message: newPin ? 'File dipin (tidak akan diarsipkan).' : 'Pin dilepas.', pinned: !!newPin });
});

// POST /api/local-files/:id/archive - manual arsip 1 file
router.post('/:id/archive', verifyToken, async (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses.' });
  }

  if (file.location === 'archive') {
    return res.status(400).json({ error: 'File sudah berstatus arsip.' });
  }

  try {
    const result = await archiveSingleFile(file);
    res.json({ message: 'File berhasil diarsipkan ke Cold Storage.', result });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengarsipkan file: ' + err.message });
  }
});

// DELETE /api/local-files/:id
router.delete('/:id', verifyToken, (req, res) => {
  const file = db.prepare('SELECT * FROM local_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File tidak ditemukan.' });

  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== file.bidang_id) {
    return res.status(403).json({ error: 'Anda tidak memiliki hak akses.' });
  }

  // Hapus file fisik
  if (file.location === 'hot' && file.hot_path) {
    const p = path.resolve(getHotStoragePath(), file.hot_path);
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch (_) {}
  } else if (file.location === 'archive' && file.archive_path) {
    const p = path.resolve(getArchiveStoragePath(), file.archive_path);
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch (_) {}
  }

  db.prepare('DELETE FROM local_files WHERE id = ?').run(file.id);

  // Log activity
  db.prepare(`
    INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    uuidv4(), req.user.id, req.user.nama, 'HAPUS_FILE_LOKAL',
    `Hapus file "${file.original_name}"`
  );

  res.json({ message: 'File berhasil dihapus.' });
});

module.exports = router;
