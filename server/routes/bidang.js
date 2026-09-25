const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET /api/bidang?tahun_id=xxx - list bidang/modul
// Jika tahun_id diberikan, filter per tahun; jika tidak, kembalikan semua
router.get('/', verifyToken, (req, res) => {
  const { tahun_id } = req.query;
  let query = `
    SELECT b.*, COUNT(d.id) as jumlah_folder, t.nama AS tahun_nama, t.label AS tahun_label
    FROM bidang b
    LEFT JOIN drive_links d ON b.id = d.bidang_id
    LEFT JOIN tahun t ON b.tahun_id = t.id
  `;
  const params = [];
  if (tahun_id) {
    query += ' WHERE b.tahun_id = ?';
    params.push(tahun_id);
  }
  query += ' GROUP BY b.id ORDER BY b.created_at ASC';
  const bidangs = db.prepare(query).all(...params);
  res.json({ bidangs });
});

// POST /api/bidang - superadmin only: tambah modul/bidang baru
router.post('/', verifyToken, requireSuperAdmin, (req, res) => {
  const { nama_bidang, tahun_id } = req.body;
  if (!nama_bidang || !nama_bidang.trim()) {
    return res.status(400).json({ error: 'Nama bidang/modul tidak boleh kosong.' });
  }
  if (!tahun_id) {
    return res.status(400).json({ error: 'Tahun wajib dipilih.' });
  }

  // Validasi tahun ada
  const tahun = db.prepare('SELECT id FROM tahun WHERE id = ?').get(tahun_id);
  if (!tahun) return res.status(400).json({ error: 'Tahun tidak ditemukan.' });

  // Cek duplikat nama dalam tahun yang sama
  const dupCheck = db.prepare('SELECT id FROM bidang WHERE nama_bidang = ? AND tahun_id = ?').get(nama_bidang.trim(), tahun_id);
  if (dupCheck) {
    return res.status(400).json({ error: 'Nama modul sudah ada untuk tahun ini.' });
  }

  const id = 'bidang-' + uuidv4().slice(0, 8);
  try {
    db.prepare('INSERT INTO bidang (id, nama_bidang, tahun_id) VALUES (?, ?, ?)').run(
      id, nama_bidang.trim(), tahun_id
    );

    db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
      uuidv4(), req.user.id, req.user.nama, 'TAMBAH_BIDANG', `Tambah modul: ${nama_bidang} (tahun_id: ${tahun_id})`
    );

    res.status(201).json({ message: 'Modul berhasil ditambahkan.', id });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah modul.' });
  }
});

// PUT /api/bidang/:id - superadmin only
router.put('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const { nama_bidang } = req.body;
  if (!nama_bidang || !nama_bidang.trim()) {
    return res.status(400).json({ error: 'Nama bidang tidak boleh kosong.' });
  }

  const existing = db.prepare('SELECT id FROM bidang WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

  try {
    db.prepare('UPDATE bidang SET nama_bidang = ? WHERE id = ?').run(nama_bidang.trim(), req.params.id);

    db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
      uuidv4(), req.user.id, req.user.nama, 'EDIT_BIDANG', `Edit bidang ID: ${req.params.id}`
    );

    res.json({ message: 'Bidang berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui bidang.' });
  }
});

// DELETE /api/bidang/:id - superadmin only
router.delete('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const existing = db.prepare('SELECT id, nama_bidang FROM bidang WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

  db.prepare('DELETE FROM bidang WHERE id = ?').run(req.params.id);

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'HAPUS_BIDANG', `Hapus bidang: ${existing.nama_bidang}`
  );

  res.json({ message: 'Bidang berhasil dihapus.' });
});

module.exports = router;
