const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET /api/unified-search - pencarian menyeluruh lintas database & drive
router.get('/', verifyToken, async (req, res) => {
  try {
    const { q, bidang_id, tahun_id, sumber, location } = req.query;
    const keyword = (q || '').trim().toLowerCase();

    const results = [];

    // 1. Ambil data Google Drive (drive_links)
    if (!sumber || sumber === 'all' || sumber === 'drive') {
      let driveQuery = `
        SELECT d.id, d.nama_folder, d.drive_folder_id, d.drive_folder_url, d.dibuat_oleh, d.created_at,
               b.id AS bidang_id, b.nama_bidang, t.id AS tahapan_id, t.label AS tahapan_label, th.id AS tahun_id, th.nama AS tahun_nama
        FROM drive_links d
        JOIN bidang b ON d.bidang_id = b.id
        LEFT JOIN tahapan t ON d.tahapan_id = t.id
        LEFT JOIN tahun th ON b.tahun_id = th.id
      `;
      const driveParams = [];
      const driveWhere = [];
      let paramIdx = 1;

      if (req.user.role === 'ADMIN_BIDANG') {
        driveWhere.push(`d.bidang_id = $${paramIdx++}`);
        driveParams.push(req.user.bidang_id);
      } else if (bidang_id) {
        driveWhere.push(`d.bidang_id = $${paramIdx++}`);
        driveParams.push(bidang_id);
      }

      if (tahun_id) {
        driveWhere.push(`b.tahun_id = $${paramIdx++}`);
        driveParams.push(tahun_id);
      }

      if (keyword) {
        driveWhere.push(`(LOWER(d.nama_folder) LIKE $${paramIdx} OR LOWER(b.nama_bidang) LIKE $${paramIdx + 1} OR LOWER(COALESCE(t.label, '')) LIKE $${paramIdx + 2})`);
        driveParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        paramIdx += 3;
      }

      if (driveWhere.length > 0) {
        driveQuery += ' WHERE ' + driveWhere.join(' AND ');
      }

      const driveResult = await pool.query(driveQuery, driveParams);
      for (const r of driveResult.rows) {
        results.push({
          id: r.id,
          nama: r.nama_folder,
          sumber: 'drive', // Google Drive
          tipe: 'folder',
          location: null,
          compressed: false,
          size: null,
          url: r.drive_folder_url,
          bidang_id: r.bidang_id,
          nama_bidang: r.nama_bidang,
          tahapan_id: r.tahapan_id,
          nama_tahapan: r.tahapan_label,
          tahun_id: r.tahun_id,
          tahun_nama: r.tahun_nama,
          uploaded_by: r.dibuat_oleh,
          created_at: r.created_at,
        });
      }
    }

    // 2. Ambil data File Lokal (local_files)
    if (!sumber || sumber === 'all' || sumber === 'local') {
      let localQuery = `
        SELECT f.*, b.nama_bidang, t.label AS tahapan_label, th.id AS tahun_id, th.nama AS tahun_nama
        FROM local_files f
        JOIN bidang b ON f.bidang_id = b.id
        LEFT JOIN tahapan t ON f.tahapan_id = t.id
        LEFT JOIN tahun th ON f.tahun_id = th.id
      `;
      const localParams = [];
      const localWhere = [];
      let paramIdx2 = 1;

      if (req.user.role === 'ADMIN_BIDANG') {
        localWhere.push(`f.bidang_id = $${paramIdx2++}`);
        localParams.push(req.user.bidang_id);
      } else if (bidang_id) {
        localWhere.push(`f.bidang_id = $${paramIdx2++}`);
        localParams.push(bidang_id);
      }

      if (tahun_id) {
        localWhere.push(`f.tahun_id = $${paramIdx2++}`);
        localParams.push(tahun_id);
      }

      if (location && ['hot', 'archive'].includes(location)) {
        localWhere.push(`f.location = $${paramIdx2++}`);
        localParams.push(location);
      }

      if (keyword) {
        localWhere.push(`(LOWER(f.original_name) LIKE $${paramIdx2} OR LOWER(b.nama_bidang) LIKE $${paramIdx2 + 1} OR LOWER(COALESCE(t.label, '')) LIKE $${paramIdx2 + 2})`);
        localParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        paramIdx2 += 3;
      }

      if (localWhere.length > 0) {
        localQuery += ' WHERE ' + localWhere.join(' AND ');
      }

      const localResult = await pool.query(localQuery, localParams);
      for (const r of localResult.rows) {
        results.push({
          id: r.id,
          nama: r.original_name,
          sumber: 'local', // Lokal Server
          tipe: 'file',
          location: r.location, // 'hot' atau 'archive'
          compressed: !!r.compressed,
          pinned: !!r.pinned,
          size: r.size,
          original_size: r.original_size,
          mime_type: r.mime_type,
          bidang_id: r.bidang_id,
          nama_bidang: r.nama_bidang,
          tahapan_id: r.tahapan_id,
          nama_tahapan: r.tahapan_label,
          tahun_id: r.tahun_id,
          tahun_nama: r.tahun_nama,
          uploaded_by: r.uploaded_by,
          created_at: r.created_at,
        });
      }
    }

    // Urutkan berdasarkan waktu pembuatan terbaru
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ results, total: results.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
