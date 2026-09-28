const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// GET /api/unified-search - pencarian menyeluruh lintas database & drive
router.get('/', verifyToken, (req, res) => {
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

    if (req.user.role === 'ADMIN_BIDANG') {
      driveWhere.push('d.bidang_id = ?');
      driveParams.push(req.user.bidang_id);
    } else if (bidang_id) {
      driveWhere.push('d.bidang_id = ?');
      driveParams.push(bidang_id);
    }

    if (tahun_id) {
      driveWhere.push('b.tahun_id = ?');
      driveParams.push(tahun_id);
    }

    if (keyword) {
      driveWhere.push('(LOWER(d.nama_folder) LIKE ? OR LOWER(b.nama_bidang) LIKE ? OR LOWER(COALESCE(t.label, "")) LIKE ?)');
      driveParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (driveWhere.length > 0) {
      driveQuery += ' WHERE ' + driveWhere.join(' AND ');
    }

    const driveRows = db.prepare(driveQuery).all(...driveParams);
    for (const r of driveRows) {
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

    if (req.user.role === 'ADMIN_BIDANG') {
      localWhere.push('f.bidang_id = ?');
      localParams.push(req.user.bidang_id);
    } else if (bidang_id) {
      localWhere.push('f.bidang_id = ?');
      localParams.push(bidang_id);
    }

    if (tahun_id) {
      localWhere.push('f.tahun_id = ?');
      localParams.push(tahun_id);
    }

    if (location && ['hot', 'archive'].includes(location)) {
      localWhere.push('f.location = ?');
      localParams.push(location);
    }

    if (keyword) {
      localWhere.push('(LOWER(f.original_name) LIKE ? OR LOWER(b.nama_bidang) LIKE ? OR LOWER(COALESCE(t.label, "")) LIKE ?)');
      localParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (localWhere.length > 0) {
      localQuery += ' WHERE ' + localWhere.join(' AND ');
    }

    const localRows = db.prepare(localQuery).all(...localParams);
    for (const r of localRows) {
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
});

module.exports = router;
