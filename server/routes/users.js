const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// GET /api/users - super admin only, list semua user
router.get('/', verifyToken, requireSuperAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.nama, u.username, u.email, u.role, u.active, u.created_at, b.nama_bidang, u.bidang_id
    FROM users u LEFT JOIN bidang b ON u.bidang_id = b.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

// POST /api/users - super admin only, buat user baru
router.post('/', verifyToken, requireSuperAdmin, (req, res) => {
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

  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return res.status(400).json({ error: 'Username sudah digunakan.' });

  if (email) {
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingEmail) return res.status(400).json({ error: 'Email sudah terdaftar.' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  const id = 'user-' + uuidv4().slice(0, 8);
  // Gunakan email dari input atau buat email dummy dari username
  const finalEmail = email || `${username}@bapperida.local`;

  db.prepare('INSERT INTO users (id, nama, username, email, password, role, bidang_id) VALUES (?,?,?,?,?,?,?)').run(
    id, nama, username.toLowerCase(), finalEmail, hashed, role, bidang_id || null
  );

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'TAMBAH_USER', `Tambah user: ${username} (${role})`
  );

  res.status(201).json({ message: 'User berhasil dibuat.', id });
});

// PUT /api/users/:id - super admin only, edit user
router.put('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const { nama, username, email, role, bidang_id, active } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

  // Cek duplikat username (kecuali milik user sendiri)
  if (username && username !== user.username) {
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return res.status(400).json({ error: 'Username hanya boleh berisi huruf, angka, titik, underscore, dan strip.' });
    }
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.params.id);
    if (dup) return res.status(400).json({ error: 'Username sudah digunakan.' });
  }

  const newNama = nama || user.nama;
  const newUsername = username ? username.toLowerCase() : user.username;
  const newEmail = email || user.email;
  const newRole = role || user.role;
  // bidang_id hanya berlaku jika role ADMIN_BIDANG; kosong string dianggap null
  let newBidangId = null;
  if (newRole === 'ADMIN_BIDANG') {
    newBidangId = (bidang_id && bidang_id.trim()) ? bidang_id.trim() : (user.bidang_id || null);
  }
  const newActive = active !== undefined ? (active ? 1 : 0) : user.active;

  db.prepare('UPDATE users SET nama=?, username=?, email=?, role=?, bidang_id=?, active=? WHERE id=?').run(
    newNama, newUsername, newEmail, newRole, newBidangId, newActive, req.params.id
  );

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'EDIT_USER', `Edit user: ${newUsername}`
  );

  res.json({ message: 'User berhasil diperbarui.' });
});

// POST /api/users/:id/reset-password - super admin only
router.post('/:id/reset-password', verifyToken, requireSuperAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.params.id);

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'RESET_PASSWORD', `Reset password: ${user.username || user.email}`
  );

  res.json({ message: 'Password berhasil direset.' });
});

// DELETE /api/users/:id - super admin only
router.delete('/:id', verifyToken, requireSuperAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });

  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

  db.prepare('INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail) VALUES (?,?,?,?,?)').run(
    uuidv4(), req.user.id, req.user.nama, 'HAPUS_USER', `Hapus user: ${user.username || user.email}`
  );

  res.json({ message: 'User berhasil dihapus.' });
});

module.exports = router;
