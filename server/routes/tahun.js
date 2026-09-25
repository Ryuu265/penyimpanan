const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET /api/tahun - semua user bisa lihat daftar tahun
router.get('/', verifyToken, (req, res) => {
  const tahun = db.prepare('SELECT * FROM tahun ORDER BY urutan ASC, nama DESC').all();
  res.json({ tahun });
});

// POST /api/tahun - superadmin only: tambah tahun baru
router.post('/', verifyToken, requireSuperAdmin, (req, res) => {
  const { nama, label } = req.body;
  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama tahun wajib diisi (contoh: 2026).' });
  }
  if (!/^\d{4}$/.test(nama.trim())) {
    return res.status(400).json({ error: 'Nama tahun harus berupa 4 digit angka (contoh: 2026).' });
  }

  const existing = db.prepare('SELECT id FROM tahun WHERE nama = ?').get(nama.trim());
  if (existing) return res.status(400).json({ error: `Tahun ${nama.trim()} sudah ada.` });

  const maxRow = db.prepare('SELECT COALESCE(MAX(urutan), -1) + 1 AS next FROM tahun').get();
  const id = 'tahun-' + nama.trim() + '-' + uuidv4().slice(0, 4);
  const finalLabel = (label && label.trim()) ? label.trim() : `Tahun Anggaran ${nama.trim()}`;

  db.prepare('INSERT INTO tahun (id, nama, label, urutan) VALUES (?, ?, ?, ?)').run(
    id, nama.trim(), finalLabel, maxRow.next
  );

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'TAMBAH_TAHUN', `Tambah tahun anggaran: ${nama.trim()}`
  );

  res.status(201).json({ message: `Tahun ${nama.trim()} berhasil ditambahkan.`, id });
});

// PUT /api/tahun/:id - superadmin only: edit label tahun
router.put('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const { nama, label } = req.body;
  const existing = db.prepare('SELECT * FROM tahun WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tahun tidak ditemukan.' });

  const newNama = (nama && nama.trim()) ? nama.trim() : existing.nama;
  const newLabel = (label && label.trim()) ? label.trim() : existing.label;

  db.prepare('UPDATE tahun SET nama = ?, label = ? WHERE id = ?').run(newNama, newLabel, req.params.id);
  res.json({ message: 'Tahun berhasil diperbarui.' });
});

// DELETE /api/tahun/:id - superadmin only
router.delete('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM tahun WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tahun tidak ditemukan.' });

  // Cek apakah ada modul yang terkait
  const modulCount = db.prepare('SELECT COUNT(*) as c FROM bidang WHERE tahun_id = ?').get(req.params.id);
  if (modulCount.c > 0) {
    return res.status(400).json({
      error: `Tidak bisa menghapus Tahun ${existing.nama} karena masih memiliki ${modulCount.c} modul. Hapus semua modul terlebih dahulu.`
    });
  }

  db.prepare('DELETE FROM tahun WHERE id = ?').run(req.params.id);

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'HAPUS_TAHUN', `Hapus tahun anggaran: ${existing.nama}`
  );

  res.json({ message: `Tahun ${existing.nama} berhasil dihapus.` });
});

module.exports = router;
