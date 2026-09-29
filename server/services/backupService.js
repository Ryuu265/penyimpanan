const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pool = require('../db');
const { v4: uuidv4 } = require('uuid');
const {
  getHotStoragePath,
  getArchiveStoragePath,
  getBackupStoragePath,
  calculateChecksum,
  ensureDirSync,
} = require('./storageService');

/**
 * Buat backup penuh sistem lokal:
 * - database SQLite (jika ada file lokal)
 * - Hot Storage folder
 * - Archive Storage folder
 */
function createFullBackup(createdBy = 'system', type = 'daily') {
  return new Promise(async (resolve, reject) => {
    try {
      const backupDir = getBackupStoragePath();
      ensureDirSync(backupDir);

      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filename = `backup_${timeStr}.zip`;
      const fullBackupPath = path.join(backupDir, filename);

      const output = fs.createWriteStream(fullBackupPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', async () => {
        try {
          const stat = fs.statSync(fullBackupPath);
          const checksum = await calculateChecksum(fullBackupPath);
          const backupId = 'bck-' + uuidv4().slice(0, 8);

          await pool.query(`
            INSERT INTO backups (id, filename, filepath, size, checksum, type, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [backupId, filename, filename, stat.size, checksum, type, createdBy]);

          // Log aktivitas
          await pool.query(`
            INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            uuidv4(),
            createdBy,
            createdBy === 'system' ? 'Sistem Backup' : 'Super Admin',
            'BACKUP_DATABASE',
            `Backup selesai: ${filename} (${stat.size} bytes)`
          ]);

          // Jalankan rotasi retensi (7 harian, 4 mingguan)
          await applyRetentionPolicy();

          resolve({
            id: backupId,
            filename,
            size: stat.size,
            checksum,
            type,
          });
        } catch (err) {
          reject(err);
        }
      });

      archive.on('error', err => reject(err));
      archive.pipe(output);

      // 1. Masukkan Database SQLite jika masih ada file lama
      const dbPath = path.resolve(process.cwd(), 'pusat_data.db');
      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'database/pusat_data.db' });
      }

      // 2. Masukkan Folder Hot Storage
      const hotDir = getHotStoragePath();
      if (fs.existsSync(hotDir)) {
        archive.directory(hotDir, 'storage/hot');
      }

      // 3. Masukkan Folder Cold Archive Storage
      const arcDir = getArchiveStoragePath();
      if (fs.existsSync(arcDir)) {
        archive.directory(arcDir, 'storage/archive');
      }

      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Aturan Retensi (Retention Policy):
 * Default: 7 harian, 4 mingguan
 */
async function applyRetentionPolicy() {
  try {
    const { rows: dRows } = await pool.query("SELECT value FROM settings WHERE key = 'backup_retention_days'");
    const { rows: wRows } = await pool.query("SELECT value FROM settings WHERE key = 'backup_retention_weeks'");

    const maxDays = parseInt(dRows[0]?.value || '7', 10);
    const maxWeeks = parseInt(wRows[0]?.value || '4', 10);

    const maxKeepTotal = maxDays + maxWeeks;

    const { rows: allBackups } = await pool.query('SELECT * FROM backups ORDER BY created_at DESC');
    if (allBackups.length > maxKeepTotal) {
      const toDelete = allBackups.slice(maxKeepTotal);
      const backupDir = getBackupStoragePath();

      for (const b of toDelete) {
        const p = path.join(backupDir, b.filename);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
        await pool.query('DELETE FROM backups WHERE id = $1', [b.id]);
      }
    }
  } catch (err) {
    console.warn('Rotasi backup error:', err.message);
  }
}

module.exports = {
  createFullBackup,
  applyRetentionPolicy,
};
