const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// GET /api/users - super admin only, list semua user
router.get('/', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nama, u.username, u.email, u.role, u.active, u.created_at, b.nama_bidang, u.bidang_id
      FROM users u LEFT JOIN bidang b ON u.bidang_id = b.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/users - super admin only, buat user baru
router.post('/', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama, username, email, password, role, bidang_id } = req.body;

    if (!nama || !username || !password || !role) {
      return res.status(400).json({ error: 'Nama, username, password, dan role wajib diisi.' });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username hanya boleh berisi huruf, angka, titik, underscore, dan strip.' });
    }
    if (!['SUPER_ADMIN', 'ADMIN_BIDANG', 'VIEWER'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid.' });
    }
    if (role === 'ADMIN_BIDANG' && !bidang_id) {
      return res.status(400).json({ error: 'Admin bidang harus memiliki bidang.' });
    }

    const existingUsername = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) return res.status(400).json({ error: 'Username sudah digunakan.' });

    if (email) {
      const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingEmail.rows.length > 0) return res.status(400).json({ error: 'Email sudah terdaftar.' });
    }

    const hashed = bcrypt.hashSync(password, 10);
    const id = 'user-' + uuidv4().slice(0, 8);
    // Gunakan email dari input atau buat email dummy dari username
    const finalEmail = email || `${username}@bapperida.local`;

    await pool.query(
      'INSERT INTO users (id, nama, username, email, password, role, bidang_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, nama, username.toLowerCase(), finalEmail, hashed, role, bidang_id || null]
    );

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'TAMBAH_USER', `Tambah user: ${username} (${role})`]
    );

    res.status(201).json({ message: 'User berhasil dibuat.', id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/users/:id - super admin only, edit user
router.put('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nama, username, email, role, bidang_id, active } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

    // Cek duplikat username (kecuali milik user sendiri)
    if (username && username !== user.username) {
      if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
        return res.status(400).json({ error: 'Username hanya boleh berisi huruf, angka, titik, underscore, dan strip.' });
      }
      const dup = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, req.params.id]);
      if (dup.rows.length > 0) return res.status(400).json({ error: 'Username sudah digunakan.' });
    }

    const newNama = nama || user.nama;
    const newUsername = username ? username.toLowerCase() : user.username;
    const newEmail = email || user.email;
    const newRole = role || user.role;
    // bidang_id hanya berlaku jika role ADMIN_BIDANG; kosong string dianggap null
    let newBidangId = null;
    if (newRole === 'ADMIN_BIDANG') {
      if (bidang_id !== undefined) {
        newBidangId = (typeof bidang_id === 'string' && bidang_id.trim()) ? bidang_id.trim() : null;
      } else {
        newBidangId = user.bidang_id;
      }
    }
    const newActive = active !== undefined ? (active ? 1 : 0) : user.active;

    await pool.query(
      'UPDATE users SET nama=$1, username=$2, email=$3, role=$4, bidang_id=$5, active=$6 WHERE id=$7',
      [newNama, newUsername, newEmail, newRole, newBidangId, newActive, req.params.id]
    );

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'EDIT_USER', `Edit user: ${newUsername}`]
    );

    res.json({ message: 'User berhasil diperbarui.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/users/:id/reset-password - super admin only
router.post('/:id/reset-password', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

    const hashed = bcrypt.hashSync(new_password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.params.id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'RESET_PASSWORD', `Reset password: ${user.username || user.email}`]
    );

    res.json({ message: 'Password berhasil direset.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/users/:id - super admin only
router.delete('/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);

    await pool.query(
      'INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.user.id, req.user.nama, 'HAPUS_USER', `Hapus user: ${user.username || user.email}`]
    );

    res.json({ message: 'User berhasil dihapus.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
