const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');

// GET /api/activity-logs - super admin only
router.get('/', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM activity_logs
      ORDER BY timestamp DESC
      LIMIT 200
    `);
    res.json({ logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
