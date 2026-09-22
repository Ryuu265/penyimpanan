const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');

// POST /api/auth/login — login dengan username
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password harus diisi.' });
  }

  const user = db.prepare(`
    SELECT u.*, b.nama_bidang FROM users u
    LEFT JOIN bidang b ON u.bidang_id = b.id
    WHERE u.username = ? AND u.active = 1
  `).get(username);

  if (!user) {
    return res.status(401).json({ error: 'Username tidak ditemukan atau akun dinonaktifkan.' });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Password salah.' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      nama: user.nama,
      username: user.username,
      email: user.email,
      role: user.role,
      bidang_id: user.bidang_id,
      nama_bidang: user.nama_bidang || null,
    }
  });
});

// GET /api/auth/me - verify token & get current user info
router.get('/me', require('../middleware/auth').verifyToken, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.nama, u.username, u.email, u.role, u.bidang_id, b.nama_bidang
    FROM users u LEFT JOIN bidang b ON u.bidang_id = b.id
    WHERE u.id = ?
  `).get(req.user.id);

  if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
  res.json({ user });
});

module.exports = router;
