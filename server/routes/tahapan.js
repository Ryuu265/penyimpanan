const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { verifyToken, requireBidangOwnerOrSuperAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const {
  ensureDirSync,
  sanitizePathSegment,
  getTahapanDir
} = require('../services/storageService');

// Helper untuk mendapatkan info bidang & tahun dari bidang_id
async function getBidangAndTahun(bidang_id) {
  const { rows } = await pool.query(`
    SELECT b.id, b.nama_bidang, b.tahun_id, t.nama AS tahun_nama
    FROM bidang b
    LEFT JOIN tahun t ON b.tahun_id = t.id
    WHERE b.id = $1
  `, [bidang_id]);
  return rows[0] || null;
}

// GET /api/tahapan?bidang_id=...
router.get('/', verifyToken, async (req, res) => {
  try {
    const { bidang_id } = req.query;
    let query = `
      SELECT t.*,
        (SELECT COUNT(*) FROM local_folders lf WHERE lf.tahapan_id = t.id) AS folder_count
      FROM tahapan t
    `;
    const params = [];

    if (bidang_id) {
      query += ' WHERE t.bidang_id = $1';
      params.push(bidang_id);
    }

    query += ' ORDER BY t.urutan ASC, t.created_at ASC';
    const { rows } = await pool.query(query, params);
    res.json({
      tahapan: rows.map(r => ({ ...r, folder_count: parseInt(r.folder_count, 10) || 0 }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// GET /api/tahapan/folder-counts?bidang_id=...
router.get('/folder-counts', verifyToken, async (req, res) => {
  try {
    const { bidang_id } = req.query;
    let query = `
      SELECT lf.tahapan_id, COUNT(*) AS count
      FROM local_folders lf
      JOIN tahapan t ON lf.tahapan_id = t.id
    `;
    const params = [];
    if (bidang_id) {
      query += ' WHERE t.bidang_id = $1';
      params.push(bidang_id);
    }
    query += ' GROUP BY lf.tahapan_id';
    const { rows } = await pool.query(query, params);
    const counts = {};
    for (const r of rows) {
      counts[r.tahapan_id] = parseInt(r.count, 10) || 0;
    }
    res.json({ counts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/tahapan - Tambah tahapan baru (Membuat folder fisik lokal)
router.post('/', verifyToken, requireBidangOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { bidang_id, label, deskripsi, icon } = req.body;

    if (!bidang_id || !label) {
      return res.status(400).json({ error: 'bidang_id dan label tahapan wajib diisi.' });
    }

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== bidang_id) {
      return res.status(403).json({ error: 'Anda hanya dapat menambahkan tahapan pada bidang Anda sendiri.' });
    }

    const bidangInfo = await getBidangAndTahun(bidang_id);
    if (!bidangInfo) {
      return res.status(404).json({ error: 'Bidang tidak ditemukan.' });
    }

    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(urutan), -1) + 1 AS next_urutan FROM tahapan WHERE bidang_id = $1',
      [bidang_id]
    );
    const urutan = maxRows[0] ? parseInt(maxRows[0].next_urutan, 10) : 0;
    const id = 'thp-' + uuidv4().slice(0, 8);
    const iconFinal = icon || '📋';
    const cleanLabel = label.trim();

    // 1. Buat direktori fisik tahapan di hot storage
    const { relPath, fullPath } = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, cleanLabel, id);
    ensureDirSync(fullPath);

    // 2. Catat ke database
    await pool.query(`
      INSERT INTO tahapan (id, bidang_id, label, deskripsi, icon, urutan)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, bidang_id, cleanLabel, deskripsi ? deskripsi.trim() : '', iconFinal, urutan]);

    // 3. Log aktivitas
    await pool.query(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      uuidv4(),
      req.user.id,
      req.user.nama,
      'TAMBAH_TAHAPAN',
      `Menambahkan tahapan lokal: "${cleanLabel}" di ${bidangInfo.nama_bidang}`
    ]);

    const { rows: createdRows } = await pool.query(`
      SELECT t.*, 0 AS folder_count FROM tahapan t WHERE t.id = $1
    `, [id]);

    res.status(201).json({ tahapan: createdRows[0], physical_path: relPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/tahapan/reorder - Mengubah urutan drag & drop
router.put('/reorder', verifyToken, requireBidangOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { bidang_id, items } = req.body;

    if (!bidang_id || !Array.isArray(items)) {
      return res.status(400).json({ error: 'bidang_id dan daftar items wajib diisi.' });
    }

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== bidang_id) {
      return res.status(403).json({ error: 'Anda hanya dapat mengubah urutan tahapan pada bidang Anda sendiri.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          'UPDATE tahapan SET urutan = $1 WHERE id = $2 AND bidang_id = $3',
          [item.urutan, item.id, bidang_id]
        );
      }
      await client.query(`
        INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        uuidv4(),
        req.user.id,
        req.user.nama,
        'UBAH_URUTAN_TAHAPAN',
        `Mengubah urutan tahapan proses perencanaan (${items.length} tahapan)`
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: updated } = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM local_folders lf WHERE lf.tahapan_id = t.id) AS folder_count
      FROM tahapan t
      WHERE t.bidang_id = $1
      ORDER BY t.urutan ASC
    `, [bidang_id]);

    res.json({
      success: true,
      tahapan: updated.map(r => ({ ...r, folder_count: parseInt(r.folder_count, 10) || 0 }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/tahapan/:id - Edit nama / deskripsi / icon tahapan (Rename folder fisik jika label berubah)
router.put('/:id', verifyToken, requireBidangOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, deskripsi, icon } = req.body;

    const { rows: currRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [id]);
    const current = currRows[0];
    if (!current) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== current.bidang_id) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin mengubah tahapan bidang ini.' });
    }

    const newLabel = label ? label.trim() : current.label;

    // Jika label berubah, ubah nama direktori fisik di storage lokal
    if (label && newLabel !== current.label) {
      const bidangInfo = await getBidangAndTahun(current.bidang_id);
      if (bidangInfo) {
        const oldDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, current.label, id);
        const newDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, newLabel, id);
        if (fs.existsSync(oldDir.fullPath) && oldDir.fullPath !== newDir.fullPath) {
          try {
            fs.renameSync(oldDir.fullPath, newDir.fullPath);
          } catch (renameErr) {
            console.warn('Gagal rename physical tahapan dir:', renameErr.message);
          }
        }
      }
    }

    await pool.query(`
      UPDATE tahapan
      SET label = COALESCE($1, label),
          deskripsi = COALESCE($2, deskripsi),
          icon = COALESCE($3, icon)
      WHERE id = $4
    `, [newLabel, deskripsi !== undefined ? deskripsi.trim() : current.deskripsi, icon || current.icon, id]);

    const { rows: updRows } = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM local_folders lf WHERE lf.tahapan_id = t.id) AS folder_count
      FROM tahapan t
      WHERE t.id = $1
    `, [id]);

    const updated = updRows[0] ? { ...updRows[0], folder_count: parseInt(updRows[0].folder_count, 10) || 0 } : null;
    res.json({ tahapan: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/tahapan/:id - Hapus tahapan (cek file & konfirmasi sebelum hapus fisik)
router.delete('/:id', verifyToken, requireBidangOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query;

    const { rows: currRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [id]);
    const current = currRows[0];
    if (!current) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== current.bidang_id) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin menghapus tahapan bidang ini.' });
    }

    // Cek apakah ada file lokal atau folder di dalam tahapan ini
    const { rows: fcRows } = await pool.query('SELECT COUNT(*) AS c FROM local_files WHERE tahapan_id = $1', [id]);
    const { rows: fldRows } = await pool.query('SELECT COUNT(*) AS c FROM local_folders WHERE tahapan_id = $1', [id]);
    const fileCount = fcRows[0] ? parseInt(fcRows[0].c, 10) : 0;
    const folderCount = fldRows[0] ? parseInt(fldRows[0].c, 10) : 0;

    // Jika berisi file/folder dan belum dikonfirmasi force, minta konfirmasi
    if ((fileCount > 0 || folderCount > 0) && force !== '1') {
      return res.status(409).json({
        error: 'Tahapan berisi data',
        needs_confirm: true,
        file_count: fileCount,
        folder_count: folderCount,
        message: `Tahapan "${current.label}" memiliki ${folderCount} folder dan ${fileCount} file dokumen. Menghapusnya akan menghapus seluruh isi direktori fisiknya. Apakah Anda yakin ingin melanjutkan?`
      });
    }

    // Hapus direktori fisik tahapan dari server storage
    const bidangInfo = await getBidangAndTahun(current.bidang_id);
    if (bidangInfo) {
      const tahapanDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, current.label, id);
      if (fs.existsSync(tahapanDir.fullPath)) {
        try {
          fs.rmSync(tahapanDir.fullPath, { recursive: true, force: true });
        } catch (rmErr) {
          console.warn('Gagal menghapus physical tahapan dir:', rmErr.message);
        }
      }
    }

    // Hapus data terkait di database
    await pool.query('DELETE FROM local_files WHERE tahapan_id = $1', [id]);
    await pool.query('DELETE FROM local_folders WHERE tahapan_id = $1', [id]);
    await pool.query('DELETE FROM tahapan WHERE id = $1', [id]);

    // Log activity
    await pool.query(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      uuidv4(),
      req.user.id,
      req.user.nama,
      'HAPUS_TAHAPAN',
      `Menghapus tahapan lokal: "${current.label}" (${fileCount} file, ${folderCount} folder)`
    ]);

    res.json({ success: true, message: 'Tahapan dan folder fisik berhasil dihapus.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// ─── FOLDER LOKAL DI DALAM TAHAPAN ──────────────────────────────────────────

// GET /api/tahapan/folders/all?bidang_id=... - Semua folder lokal dalam suatu bidang
router.get('/folders/all', verifyToken, async (req, res) => {
  try {
    const { bidang_id } = req.query;
    let query = `
      SELECT lf.*, t.label AS nama_tahapan,
        (SELECT COUNT(*) FROM local_files f WHERE f.tahapan_id = lf.tahapan_id AND (f.folder_path = lf.nama_folder OR f.folder_path LIKE lf.nama_folder || '/%')) AS file_count
      FROM local_folders lf
      JOIN tahapan t ON lf.tahapan_id = t.id
    `;
    const params = [];
    if (bidang_id) {
      query += ' WHERE lf.bidang_id = $1';
      params.push(bidang_id);
    }
    query += ' ORDER BY lf.created_at ASC';
    const { rows } = await pool.query(query, params);
    res.json({
      folders: rows.map(r => ({ ...r, file_count: parseInt(r.file_count, 10) || 0 }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// GET /api/tahapan/:id/folders - Daftar folder lokal dalam tahapan ini
router.get('/:id/folders', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: tRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [id]);
    const tahapan = tRows[0];
    if (!tahapan) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    const { rows: folders } = await pool.query(`
      SELECT lf.*,
        (SELECT COUNT(*) FROM local_files f WHERE f.tahapan_id = lf.tahapan_id AND (f.folder_path = lf.nama_folder OR f.folder_path LIKE lf.nama_folder || '/%')) AS file_count
      FROM local_folders lf
      WHERE lf.tahapan_id = $1
      ORDER BY lf.created_at ASC
    `, [id]);

    res.json({
      folders: folders.map(r => ({ ...r, file_count: parseInt(r.file_count, 10) || 0 }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/tahapan/:id/folders - Buat folder fisik lokal di dalam tahapan
router.post('/:id/folders', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_folder } = req.body;

    if (!nama_folder || !nama_folder.trim()) {
      return res.status(400).json({ error: 'Nama folder wajib diisi.' });
    }

    const { rows: tRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [id]);
    const tahapan = tRows[0];
    if (!tahapan) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== tahapan.bidang_id) {
      return res.status(403).json({ error: 'Anda hanya dapat menambah folder pada bidang Anda.' });
    }

    const bidangInfo = await getBidangAndTahun(tahapan.bidang_id);
    if (!bidangInfo) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

    // Sanitasi nama folder untuk mencegah path traversal dan karakter aneh
    const cleanName = sanitizePathSegment(nama_folder.trim());
    if (!cleanName || cleanName === 'folder' && nama_folder.trim() !== 'folder') {
      return res.status(400).json({ error: 'Nama folder tidak valid.' });
    }

    // Cek duplikasi nama folder di tahapan yang sama
    const { rows: existingRows } = await pool.query(`
      SELECT id FROM local_folders WHERE tahapan_id = $1 AND LOWER(nama_folder) = LOWER($2)
    `, [id, cleanName]);

    if (existingRows.length > 0) {
      return res.status(400).json({ error: `Folder dengan nama "${cleanName}" sudah ada di tahapan ini.` });
    }

    // Buat direktori fisik di storage lokal
    const tahapanDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, tahapan.label, id);
    const physicalFolder = path.join(tahapanDir.fullPath, cleanName);
    ensureDirSync(physicalFolder);

    const folderId = 'lfol-' + uuidv4().slice(0, 8);
    const relPath = path.join(tahapanDir.relPath, cleanName);

    await pool.query(`
      INSERT INTO local_folders (id, tahun_id, bidang_id, tahapan_id, nama_folder, relative_path, dibuat_oleh, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [folderId, bidangInfo.tahun_id || null, tahapan.bidang_id, id, cleanName, relPath, req.user.nama, req.user.id]);

    // Log aktivitas
    await pool.query(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      uuidv4(),
      req.user.id,
      req.user.nama,
      'TAMBAH_FOLDER_LOKAL',
      `Membuat folder lokal: "${cleanName}" di tahapan ${tahapan.label}`
    ]);

    const { rows: createdRows } = await pool.query(`
      SELECT lf.*, 0 AS file_count FROM local_folders lf WHERE lf.id = $1
    `, [folderId]);

    res.status(201).json({ folder: createdRows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/tahapan/:tahapanId/folders/:folderId - Rename folder lokal
router.put('/:tahapanId/folders/:folderId', verifyToken, async (req, res) => {
  try {
    const { tahapanId, folderId } = req.params;
    const { nama_folder } = req.body;

    if (!nama_folder || !nama_folder.trim()) {
      return res.status(400).json({ error: 'Nama folder baru wajib diisi.' });
    }

    const { rows: fRows } = await pool.query(
      'SELECT * FROM local_folders WHERE id = $1 AND tahapan_id = $2',
      [folderId, tahapanId]
    );
    const folder = fRows[0];
    if (!folder) return res.status(404).json({ error: 'Folder tidak ditemukan.' });

    const { rows: tRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [tahapanId]);
    const tahapan = tRows[0];
    if (!tahapan) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== tahapan.bidang_id) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin mengubah folder ini.' });
    }

    const cleanNewName = sanitizePathSegment(nama_folder.trim());
    if (cleanNewName.toLowerCase() === folder.nama_folder.toLowerCase()) {
      return res.json({ folder });
    }

    // Cek duplikasi
    const { rows: dupRows } = await pool.query(
      'SELECT id FROM local_folders WHERE tahapan_id = $1 AND LOWER(nama_folder) = LOWER($2) AND id != $3',
      [tahapanId, cleanNewName, folderId]
    );
    if (dupRows.length > 0) {
      return res.status(400).json({ error: `Folder dengan nama "${cleanNewName}" sudah ada.` });
    }

    const bidangInfo = await getBidangAndTahun(tahapan.bidang_id);
    if (bidangInfo) {
      const tahapanDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, tahapan.label, tahapanId);
      const oldPath = path.join(tahapanDir.fullPath, folder.nama_folder);
      const newPath = path.join(tahapanDir.fullPath, cleanNewName);
      if (fs.existsSync(oldPath)) {
        try {
          fs.renameSync(oldPath, newPath);
        } catch (err) {
          console.warn('Gagal rename physical folder:', err.message);
        }
      }
    }

    // Update paths di database
    await pool.query(`
      UPDATE local_folders
      SET nama_folder = $1, updated_at = NOW()
      WHERE id = $2
    `, [cleanNewName, folderId]);

    // Update folder_path di local_files jika ada
    await pool.query(`
      UPDATE local_files
      SET folder_path = $1
      WHERE tahapan_id = $2 AND folder_path = $3
    `, [cleanNewName, tahapanId, folder.nama_folder]);

    const { rows: updRows } = await pool.query(`
      SELECT lf.*,
        (SELECT COUNT(*) FROM local_files f WHERE f.tahapan_id = lf.tahapan_id AND (f.folder_path = lf.nama_folder OR f.folder_path LIKE lf.nama_folder || '/%')) AS file_count
      FROM local_folders lf
      WHERE lf.id = $1
    `, [folderId]);

    const updated = updRows[0] ? { ...updRows[0], file_count: parseInt(updRows[0].file_count, 10) || 0 } : null;
    res.json({ folder: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/tahapan/:tahapanId/folders/:folderId - Hapus folder lokal
router.delete('/:tahapanId/folders/:folderId', verifyToken, async (req, res) => {
  try {
    const { tahapanId, folderId } = req.params;
    const { force } = req.query;

    const { rows: fRows } = await pool.query(
      'SELECT * FROM local_folders WHERE id = $1 AND tahapan_id = $2',
      [folderId, tahapanId]
    );
    const folder = fRows[0];
    if (!folder) return res.status(404).json({ error: 'Folder tidak ditemukan.' });

    const { rows: tRows } = await pool.query('SELECT * FROM tahapan WHERE id = $1', [tahapanId]);
    const tahapan = tRows[0];
    if (!tahapan) return res.status(404).json({ error: 'Tahapan tidak ditemukan.' });

    if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== tahapan.bidang_id) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin menghapus folder ini.' });
    }

    // Hitung file di dalam folder
    const { rows: fcRows } = await pool.query(`
      SELECT COUNT(*) AS c FROM local_files
      WHERE tahapan_id = $1 AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
    `, [tahapanId, folder.nama_folder]);
    const fileCount = fcRows[0] ? parseInt(fcRows[0].c, 10) : 0;

    if (fileCount > 0 && force !== '1') {
      return res.status(409).json({
        error: 'Folder berisi file',
        needs_confirm: true,
        file_count: fileCount,
        message: `Folder "${folder.nama_folder}" berisi ${fileCount} file dokumen. Menghapusnya akan menghapus semua file di dalamnya. Apakah Anda yakin?`
      });
    }

    // Hapus fisik direktori
    const bidangInfo = await getBidangAndTahun(tahapan.bidang_id);
    if (bidangInfo) {
      const tahapanDir = getTahapanDir(bidangInfo.tahun_nama, bidangInfo.nama_bidang, tahapan.label, tahapanId);
      const physicalFolder = path.join(tahapanDir.fullPath, folder.nama_folder);
      if (fs.existsSync(physicalFolder)) {
        try {
          fs.rmSync(physicalFolder, { recursive: true, force: true });
        } catch (err) {
          console.warn('Gagal menghapus physical folder:', err.message);
        }
      }
    }

    // Hapus records
    await pool.query(`
      DELETE FROM local_files WHERE tahapan_id = $1 AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
    `, [tahapanId, folder.nama_folder]);
    await pool.query('DELETE FROM local_folders WHERE id = $1', [folderId]);

    // Log activity
    await pool.query(`
      INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      uuidv4(),
      req.user.id,
      req.user.nama,
      'HAPUS_FOLDER_LOKAL',
      `Menghapus folder lokal: "${folder.nama_folder}" di tahapan ${tahapan.label}`
    ]);

    res.json({ success: true, message: 'Folder lokal berhasil dihapus.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
