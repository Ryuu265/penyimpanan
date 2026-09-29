const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET /api/tahun - semua user bisa lihat daftar tahun
router.get('/', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tahun ORDER BY urutan ASC, nama DESC');
    res.json({ tahun: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/tahun - superadmin only: tambah tahun baru
router.post('/', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama, label } = req.body;
    if (!nama || !nama.trim()) {
      return res.status(400).json({ error: 'Nama tahun wajib diisi (contoh: 2026).' });
    }
    if (!/^\d{4}$/.test(nama.trim())) {
      return res.status(400).json({ error: 'Nama tahun harus berupa 4 digit angka (contoh: 2026).' });
    }

    const existResult = await pool.query('SELECT id FROM tahun WHERE nama = $1', [nama.trim()]);
    if (existResult.rows.length > 0) return res.status(400).json({ error: `Tahun ${nama.trim()} sudah ada.` });

    const maxResult = await pool.query('SELECT COALESCE(MAX(urutan), -1) + 1 AS next FROM tahun');
    const id = 'tahun-' + nama.trim() + '-' + uuidv4().slice(0, 4);
    const finalLabel = (label && label.trim()) ? label.trim() : `Tahun Anggaran ${nama.trim()}`;

    await pool.query('INSERT INTO tahun (id, nama, label, urutan) VALUES ($1, $2, $3, $4)', [
      id, nama.trim(), finalLabel, maxResult.rows[0].next
    ]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'TAMBAH_TAHUN', `Tambah tahun anggaran: ${nama.trim()}`]
    );

    res.status(201).json({ message: `Tahun ${nama.trim()} berhasil ditambahkan.`, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/tahun/:id - superadmin only: edit label tahun
router.put('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama, label } = req.body;
    const existResult = await pool.query('SELECT * FROM tahun WHERE id = $1', [req.params.id]);
    const existing = existResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Tahun tidak ditemukan.' });

    const newNama = (nama && nama.trim()) ? nama.trim() : existing.nama;
    const newLabel = (label && label.trim()) ? label.trim() : existing.label;

    await pool.query('UPDATE tahun SET nama = $1, label = $2 WHERE id = $3', [newNama, newLabel, req.params.id]);
    res.json({ message: 'Tahun berhasil diperbarui.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/tahun/:id - superadmin only
router.delete('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const existResult = await pool.query('SELECT * FROM tahun WHERE id = $1', [req.params.id]);
    const existing = existResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Tahun tidak ditemukan.' });

    // Cek apakah ada modul yang terkait
    const modulResult = await pool.query('SELECT COUNT(*) as c FROM bidang WHERE tahun_id = $1', [req.params.id]);
    if (parseInt(modulResult.rows[0].c, 10) > 0) {
      return res.status(400).json({
        error: `Tidak bisa menghapus Tahun ${existing.nama} karena masih memiliki ${modulResult.rows[0].c} modul. Hapus semua modul terlebih dahulu.`
      });
    }

    await pool.query('DELETE FROM tahun WHERE id = $1', [req.params.id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'HAPUS_TAHUN', `Hapus tahun anggaran: ${existing.nama}`]
    );

    res.json({ message: `Tahun ${existing.nama} berhasil dihapus.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
