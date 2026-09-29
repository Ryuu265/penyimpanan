require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tahun', require('./routes/tahun'));
app.use('/api/bidang', require('./routes/bidang'));
app.use('/api/users', require('./routes/users'));
app.use('/api/drive-links', require('./routes/driveLinks'));
app.use('/api/drive', require('./routes/drive'));
app.use('/api/activity-logs', require('./routes/activityLogs'));
app.use('/api/tahapan', require('./routes/tahapan'));
app.use('/api/admin/keepalive', require('./routes/keepAlive'));
app.use('/api/local-files', require('./routes/localFiles'));
app.use('/api/backups', require('./routes/backups'));
app.use('/api/archive', require('./routes/archive'));
app.use('/api/search', require('./routes/search'));


// Health check & Ping
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Pusat Data Bapperida API running', timestamp: new Date().toISOString() });
});

app.get('/api/ping', (req, res) => {
  res.json({ status: 'pong', timestamp: new Date().toISOString() });
});

// 404 handler for API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Serve Vue frontend (dist/) — hanya jika sudah di-build
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Catch-all: kembalikan index.html untuk Vue Router SPA
  // Gunakan app.use() agar kompatibel dengan Express 4 & 5
  app.use((req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.use((req, res) => {
    res.json({ message: 'Pusat Data Bapperida API. Frontend belum di-build.' });
  });
}

const keepAliveService = require('./services/keepAlive');
const storageService = require('./services/storageService');
const schedulerService = require('./services/schedulerService');
const { initDb } = require('./db');

// Inisialisasi database PostgreSQL sebelum server mulai listen
(async () => {
  try {
    await initDb();
  } catch (err) {
    console.error('❌ Gagal inisialisasi database:', err);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Pusat Data Bapperida API Server`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Health:     http://localhost:${PORT}/api/health\n`);
    
    // Inisialisasi direktori penyimpanan lokal (hot, archive, backup, cache)
    storageService.initStorageDirs();

    // Inisialisasi Auto-Reset / Keep-Alive Service
    keepAliveService.init();

    // Inisialisasi Scheduler Arsip & Backup Otomatis
    schedulerService.initScheduler();
  });
})();

module.exports = app;
