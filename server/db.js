const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Koneksi ke PostgreSQL (Supabase) via DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Inisialisasi tabel & seed ─────────────────────────────────────────────────
async function initDb() {
  // Create tables — urutan memperhatikan foreign key dependency
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tahun (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL UNIQUE,
      label TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bidang (
      id TEXT PRIMARY KEY,
      nama_bidang TEXT NOT NULL,
      tahun_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tahapan (
      id TEXT PRIMARY KEY,
      bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      deskripsi TEXT,
      icon TEXT DEFAULT '📋',
      urutan INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS drive_links (
      id TEXT PRIMARY KEY,
      bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
      nama_folder TEXT NOT NULL,
      drive_folder_id TEXT NOT NULL,
      drive_folder_url TEXT NOT NULL,
      tahapan_id TEXT REFERENCES tahapan(id) ON DELETE SET NULL,
      dibuat_oleh TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_nama TEXT NOT NULL,
      aksi TEXT NOT NULL,
      target_link_id TEXT,
      detail TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS local_files (
      id TEXT PRIMARY KEY,
      tahun_id TEXT REFERENCES tahun(id) ON DELETE SET NULL,
      bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
      tahapan_id TEXT REFERENCES tahapan(id) ON DELETE SET NULL,
      folder_path TEXT NOT NULL DEFAULT '',
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      original_size INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT 'hot' CHECK(location IN ('hot', 'archive')),
      hot_path TEXT,
      archive_path TEXT,
      checksum TEXT,
      compressed INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived_at TIMESTAMPTZ,
      uploaded_by TEXT NOT NULL,
      user_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      checksum TEXT,
      type TEXT NOT NULL DEFAULT 'daily',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS local_folders (
      id TEXT PRIMARY KEY,
      tahun_id TEXT REFERENCES tahun(id) ON DELETE SET NULL,
      bidang_id TEXT NOT NULL REFERENCES bidang(id) ON DELETE CASCADE,
      tahapan_id TEXT REFERENCES tahapan(id) ON DELETE CASCADE,
      nama_folder TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      dibuat_oleh TEXT NOT NULL,
      user_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Index unik username (partial index, sama seperti SQLite)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL
  `);

  // ─── Hapus data dummy (kecuali superadmin) ───────────────────────────────
  try {
    await pool.query("DELETE FROM users WHERE role != 'SUPER_ADMIN' AND id != 'user-super-001'");
    await pool.query("DELETE FROM drive_links WHERE drive_folder_id LIKE 'mock-%' OR id LIKE 'link-%'");
    await pool.query("DELETE FROM activity_logs WHERE target_link_id LIKE 'link-%' OR user_id IN ('user-admin-perencanaan', 'user-admin-palev', 'user-viewer-001')");
  } catch (_) { /* Abaikan jika sudah bersih */ }

  // ─── Seed functions ────────────────────────────────────────────────────
  await seed();
  await seedTahun();
  await seedTahapan();
  await seedSettings();
  await migrateUsername();

  console.log('✅ PostgreSQL database initialized');
}

// ─── Seed: hanya Super Admin default ─────────────────────────────────────────
async function seed() {
  const hashSuperAdmin = bcrypt.hashSync('superadmin123', 10);
  const insertUser = 'INSERT INTO users (id, nama, username, email, password, role, bidang_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING';
  await pool.query(insertUser, ['user-super-001', 'Super Admin', 'superadmin', 'superadmin@bapperida.go.id', hashSuperAdmin, 'SUPER_ADMIN', null]);

  console.log('✅ Super Admin seeded successfully');
}

async function seedTahun() {
  const defaultTahunId = 'tahun-2025-001';
  await pool.query(
    'INSERT INTO tahun (id, nama, label, urutan) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
    [defaultTahunId, '2025', 'Tahun Anggaran 2025', 0]
  );
  await pool.query(
    'INSERT INTO bidang (id, nama_bidang, tahun_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    ['bidang-perencanaan-001', 'Perencanaan', defaultTahunId]
  );
  await pool.query(
    'INSERT INTO bidang (id, nama_bidang, tahun_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    ['bidang-palev-002', 'Pengendalian & Evaluasi (Palev)', defaultTahunId]
  );
  await pool.query(
    "UPDATE bidang SET tahun_id = $1 WHERE tahun_id IS NULL OR tahun_id = ''",
    [defaultTahunId]
  );
  console.log('✅ Tahun 2025 seeded and bidangs linked');
}

async function seedTahapan() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM tahapan');
  if (parseInt(rows[0].c, 10) > 0) return;

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

  const insertSql = 'INSERT INTO tahapan (id, bidang_id, label, deskripsi, icon, urutan) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING';
  for (const t of tahapanPerencanaan) {
    await pool.query(insertSql, [t.id, bidang1Id, t.label, t.deskripsi, t.icon, t.urutan]);
  }
  for (const t of tahapanPalev) {
    await pool.query(insertSql, [t.id, bidang2Id, t.label, t.deskripsi, t.icon, t.urutan]);
  }
  console.log('✅ Tahapan seeded successfully');
}

async function seedSettings() {
  const defaults = [
    { key: 'keepalive_active', value: '1' },
    { key: 'keepalive_interval', value: '10' },
    { key: 'keepalive_schedule_enabled', value: '1' },
    { key: 'keepalive_work_start', value: '08:00' },
    { key: 'keepalive_work_end', value: '17:00' },
    { key: 'keepalive_last_ping', value: '' },
    { key: 'keepalive_last_status', value: 'Belum ada ping' },
    { key: 'keepalive_ping_count', value: '0' },
    { key: 'archive_lifecycle_days', value: '30' },
    { key: 'archive_lifecycle_time', value: '01:00' },
    { key: 'archive_lifecycle_enabled', value: '1' },
    { key: 'backup_time', value: '01:30' },
    { key: 'backup_enabled', value: '1' },
    { key: 'backup_retention_days', value: '7' },
    { key: 'backup_retention_weeks', value: '4' },
  ];

  for (const item of defaults) {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [item.key, item.value]
    );
  }
}

async function migrateUsername() {
  await pool.query(
    "UPDATE users SET username = 'superadmin' WHERE id = 'user-super-001' AND (username IS NULL OR username = '')"
  );
}

module.exports = pool;
module.exports.initDb = initDb;
