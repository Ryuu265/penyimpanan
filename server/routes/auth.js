const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');

// POST /api/auth/login — login dengan username
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password harus diisi.' });
    }

    const { rows } = await pool.query(`
      SELECT u.*, b.nama_bidang FROM users u
      LEFT JOIN bidang b ON u.bidang_id = b.id
      WHERE u.username = $1 AND u.active = 1
    `, [username]);

    const user = rows[0];

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// GET /api/auth/me - verify token & get current user info
router.get('/me', require('../middleware/auth').verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.nama, u.username, u.email, u.role, u.bidang_id, b.nama_bidang
      FROM users u LEFT JOIN bidang b ON u.bidang_id = b.id
      WHERE u.id = $1
    `, [req.user.id]);

    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
