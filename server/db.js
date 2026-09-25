const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'pusat_data.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tahun (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL UNIQUE,
    label TEXT,
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bidang (
    id TEXT PRIMARY KEY,
    nama_bidang TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    username TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','ADMIN_BIDANG','VIEWER')),
    bidang_id TEXT REFERENCES bidang(id) ON DELETE SET NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drive_links (
    id TEXT PRIMARY KEY,
    bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
    nama_folder TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL,
    drive_folder_url TEXT NOT NULL,
    tahapan_id TEXT REFERENCES tahapan(id) ON DELETE SET NULL,
    dibuat_oleh TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_nama TEXT NOT NULL,
    aksi TEXT NOT NULL,
    target_link_id TEXT,
    detail TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tahapan (
    id TEXT PRIMARY KEY,
    bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    deskripsi TEXT,
    icon TEXT DEFAULT '📋',
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Migrasi aman ──────────────────────────────────────────────────────────

// 1. Migrasi: Restrukturisasi tabel bidang
//    - Hapus UNIQUE constraint pada nama_bidang (agar bisa ada nama sama lintas tahun)
//    - Tambah kolom tahun_id
try {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bidang'").get();
  const needsMigration = tableInfo && tableInfo.sql.includes('UNIQUE') && !tableInfo.sql.includes('tahun_id');
  if (needsMigration) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE _bidang_migrated (
        id TEXT PRIMARY KEY,
        nama_bidang TEXT NOT NULL,
        tahun_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO _bidang_migrated (id, nama_bidang, created_at)
        SELECT id, nama_bidang, created_at FROM bidang;
      DROP TABLE bidang;
      ALTER TABLE _bidang_migrated RENAME TO bidang;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Bidang table migrated: removed UNIQUE, added tahun_id');
  }
} catch (err) {
  try { db.pragma('foreign_keys = ON'); } catch (_) {}
  try { db.exec('ROLLBACK;'); } catch (_) {}
  try { db.exec('DROP TABLE IF EXISTS _bidang_migrated;'); } catch (_) {}
  console.error('Migration bidang error:', err.message);
}

// 2. Migrasi kolom tahun_id jika belum ada (untuk DB yang sudah dimigrasi sebelumnya)
try {
  db.prepare('ALTER TABLE bidang ADD COLUMN tahun_id TEXT').run();
} catch (_) { /* kolom sudah ada */ }

// 3. Migrasi kolom lain
try {
  db.prepare("ALTER TABLE drive_links ADD COLUMN tahapan_id TEXT REFERENCES tahapan(id) ON DELETE SET NULL").run();
} catch (_) { /* Kolom sudah ada */ }

try {
  db.prepare("ALTER TABLE users ADD COLUMN username TEXT").run();
} catch (_) { /* Kolom sudah ada */ }

// Buat index unik username (ignore jika sudah ada)
try {
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL").run();
} catch (_) { /* Index sudah ada */ }

// ─── Hapus data dummy ────────────────────────────────────────────────────────
try {
  db.prepare("DELETE FROM drive_links WHERE drive_folder_id LIKE 'mock-%' OR id LIKE 'link-%'").run();
  db.prepare("DELETE FROM activity_logs WHERE target_link_id LIKE 'link-%'").run();
} catch (_) { /* Abaikan jika tabel belum ada atau sudah bersih */ }

// ─── Seed functions ──────────────────────────────────────────────────────────
function seed() {
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (existing.c > 0) return;

  const bidang1Id = 'bidang-perencanaan-001';
  const bidang2Id = 'bidang-palev-002';

  db.prepare('INSERT OR IGNORE INTO bidang (id, nama_bidang) VALUES (?, ?)').run(bidang1Id, 'Perencanaan');
  db.prepare('INSERT OR IGNORE INTO bidang (id, nama_bidang) VALUES (?, ?)').run(bidang2Id, 'Pengendalian & Evaluasi (Palev)');

  const hashSuperAdmin = bcrypt.hashSync('superadmin123', 10);
  const hashAdmin1 = bcrypt.hashSync('admin123', 10);
  const hashAdmin2 = bcrypt.hashSync('admin123', 10);
  const hashViewer = bcrypt.hashSync('viewer123', 10);

  db.prepare('INSERT OR IGNORE INTO users (id, nama, username, email, password, role, bidang_id) VALUES (?,?,?,?,?,?,?)').run(
    'user-super-001', 'Super Admin', 'superadmin', 'superadmin@bapperida.go.id', hashSuperAdmin, 'SUPER_ADMIN', null
  );
  db.prepare('INSERT OR IGNORE INTO users (id, nama, username, email, password, role, bidang_id) VALUES (?,?,?,?,?,?,?)').run(
    'user-admin-perencanaan', 'Admin Perencanaan', 'admin.perencanaan', 'admin.perencanaan@bapperida.go.id', hashAdmin1, 'ADMIN_BIDANG', bidang1Id
  );
  db.prepare('INSERT OR IGNORE INTO users (id, nama, username, email, password, role, bidang_id) VALUES (?,?,?,?,?,?,?)').run(
    'user-admin-palev', 'Admin Palev', 'admin.palev', 'admin.palev@bapperida.go.id', hashAdmin2, 'ADMIN_BIDANG', bidang2Id
  );
  db.prepare('INSERT OR IGNORE INTO users (id, nama, username, email, password, role, bidang_id) VALUES (?,?,?,?,?,?,?)').run(
    'user-viewer-001', 'Pegawai Umum', 'pegawai', 'pegawai@bapperida.go.id', hashViewer, 'VIEWER', null
  );
  console.log('✅ Database seeded successfully');
}

function seedTahun() {
  // Buat tahun 2025 sebagai default jika belum ada
  const defaultTahunId = 'tahun-2025-001';
  db.prepare('INSERT OR IGNORE INTO tahun (id, nama, label, urutan) VALUES (?, ?, ?, ?)').run(
    defaultTahunId, '2025', 'Tahun Anggaran 2025', 0
  );
  // Hubungkan bidang yang belum punya tahun ke tahun 2025
  db.prepare("UPDATE bidang SET tahun_id = ? WHERE tahun_id IS NULL OR tahun_id = ''").run(defaultTahunId);
  console.log('✅ Tahun 2025 seeded and bidangs linked');
}

function seedTahapan() {
  const existing = db.prepare('SELECT COUNT(*) as c FROM tahapan').get();
  if (existing.c > 0) return;

  const bidang1Id = 'bidang-perencanaan-001';
  const bidang2Id = 'bidang-palev-002';

  const tahapanPerencanaan = [
    { id: 'thp-p-1', label: 'RPJMD', deskripsi: 'Rencana Pembangunan Jangka Menengah Daerah', icon: '📋', urutan: 0 },
    { id: 'thp-p-2', label: 'RKPD', deskripsi: 'Rencana Kerja Pemerintah Daerah', icon: '📅', urutan: 1 },
    { id: 'thp-p-3', label: 'Renja OPD', deskripsi: 'Rencana Kerja OPD/SKPD', icon: '📄', urutan: 2 },
    { id: 'thp-p-4', label: 'RKA/DPA', deskripsi: 'Rencana Kerja Anggaran & Dokumen Pelaksanaan', icon: '💰', urutan: 3 },
    { id: 'thp-p-5', label: 'Pelaksanaan', deskripsi: 'Implementasi & Monitoring Program', icon: '✅', urutan: 4 },
  ];

  const tahapanPalev = [
    { id: 'thp-v-1', label: 'Monitoring Renja', deskripsi: 'Pemantauan Berkala Triwulan', icon: '🔍', urutan: 0 },
    { id: 'thp-v-2', label: 'Evaluasi RKPD', deskripsi: 'Penilaian Capaian Target Kinerja', icon: '📊', urutan: 1 },
    { id: 'thp-v-3', label: 'Laporan LKPJ', deskripsi: 'Laporan Keterangan Pertanggungjawaban', icon: '📑', urutan: 2 },
    { id: 'thp-v-4', label: 'Rekomendasi Palev', deskripsi: 'Tindak Lanjut & Umpan Balik', icon: '💡', urutan: 3 },
  ];

  const insertStmt = db.prepare('INSERT OR IGNORE INTO tahapan (id, bidang_id, label, deskripsi, icon, urutan) VALUES (?,?,?,?,?,?)');
  for (const t of tahapanPerencanaan) {
    insertStmt.run(t.id, bidang1Id, t.label, t.deskripsi, t.icon, t.urutan);
  }
  for (const t of tahapanPalev) {
    insertStmt.run(t.id, bidang2Id, t.label, t.deskripsi, t.icon, t.urutan);
  }
  console.log('✅ Tahapan seeded successfully');
}

function seedSettings() {
  const defaults = [
    { key: 'keepalive_active', value: '1' },
    { key: 'keepalive_interval', value: '10' },
    { key: 'keepalive_schedule_enabled', value: '1' },
    { key: 'keepalive_work_start', value: '08:00' },
    { key: 'keepalive_work_end', value: '17:00' },
    { key: 'keepalive_last_ping', value: '' },
    { key: 'keepalive_last_status', value: 'Belum ada ping' },
    { key: 'keepalive_ping_count', value: '0' },
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const item of defaults) {
    stmt.run(item.key, item.value);
  }
}

function migrateUsername() {
  const defaults = [
    { id: 'user-super-001', username: 'superadmin' },
    { id: 'user-admin-perencanaan', username: 'admin.perencanaan' },
    { id: 'user-admin-palev', username: 'admin.palev' },
    { id: 'user-viewer-001', username: 'pegawai' },
  ];
  const stmt = db.prepare("UPDATE users SET username = ? WHERE id = ? AND (username IS NULL OR username = '')");
  for (const u of defaults) {
    stmt.run(u.username, u.id);
  }
}

seed();
seedTahun();
seedTahapan();
seedSettings();
migrateUsername();

module.exports = db;
