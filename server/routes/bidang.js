const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET /api/bidang?tahun_id=xxx - list bidang/modul
// Jika tahun_id diberikan, filter per tahun; jika tidak, kembalikan semua
router.get('/', verifyToken, async (req, res) => {
  try {
    const { tahun_id } = req.query;
    let query = `
      SELECT b.*, COUNT(d.id) as jumlah_folder, t.nama AS tahun_nama, t.label AS tahun_label
      FROM bidang b
      LEFT JOIN drive_links d ON b.id = d.bidang_id
      LEFT JOIN tahun t ON b.tahun_id = t.id
    `;
    const params = [];
    if (tahun_id) {
      query += ' WHERE b.tahun_id = $1';
      params.push(tahun_id);
    }
    query += ' GROUP BY b.id, t.nama, t.label ORDER BY b.created_at ASC';
    const { rows } = await pool.query(query, params);
    res.json({ bidangs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/bidang - superadmin only: tambah modul/bidang baru
router.post('/', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama_bidang, tahun_id } = req.body;
    if (!nama_bidang || !nama_bidang.trim()) {
      return res.status(400).json({ error: 'Nama bidang/modul tidak boleh kosong.' });
    }
    if (!tahun_id) {
      return res.status(400).json({ error: 'Tahun wajib dipilih.' });
    }

    // Validasi tahun ada
    const tahunResult = await pool.query('SELECT id FROM tahun WHERE id = $1', [tahun_id]);
    if (tahunResult.rows.length === 0) return res.status(400).json({ error: 'Tahun tidak ditemukan.' });

    // Cek duplikat nama dalam tahun yang sama
    const dupResult = await pool.query('SELECT id FROM bidang WHERE nama_bidang = $1 AND tahun_id = $2', [nama_bidang.trim(), tahun_id]);
    if (dupResult.rows.length > 0) {
      return res.status(400).json({ error: 'Nama modul sudah ada untuk tahun ini.' });
    }

    const id = 'bidang-' + uuidv4().slice(0, 8);

    await pool.query('INSERT INTO bidang (id, nama_bidang, tahun_id) VALUES ($1, $2, $3)', [id, nama_bidang.trim(), tahun_id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'TAMBAH_BIDANG', `Tambah modul: ${nama_bidang} (tahun_id: ${tahun_id})`]
    );

    res.status(201).json({ message: 'Modul berhasil ditambahkan.', id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah modul.' });
  }
});

// PUT /api/bidang/:id - superadmin only
router.put('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama_bidang } = req.body;
    if (!nama_bidang || !nama_bidang.trim()) {
      return res.status(400).json({ error: 'Nama bidang tidak boleh kosong.' });
    }

    const existResult = await pool.query('SELECT id FROM bidang WHERE id = $1', [req.params.id]);
    if (existResult.rows.length === 0) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

    await pool.query('UPDATE bidang SET nama_bidang = $1 WHERE id = $2', [nama_bidang.trim(), req.params.id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'EDIT_BIDANG', `Edit bidang ID: ${req.params.id}`]
    );

    res.json({ message: 'Bidang berhasil diperbarui.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui bidang.' });
  }
});

// DELETE /api/bidang/:id - superadmin only
router.delete('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const existResult = await pool.query('SELECT id, nama_bidang FROM bidang WHERE id = $1', [req.params.id]);
    const existing = existResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

    await pool.query('DELETE FROM bidang WHERE id = $1', [req.params.id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'HAPUS_BIDANG', `Hapus bidang: ${existing.nama_bidang}`]
    );

    res.json({ message: 'Bidang berhasil dihapus.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
