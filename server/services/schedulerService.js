const cron = require('node-cron');
const pool = require('../db');
const { runArchiveLifecycle } = require('./archiveService');
const { createFullBackup } = require('./backupService');
const { cleanOldCache } = require('./storageService');

let archiveTask = null;
let backupTask = null;

function convertTimeToCron(timeStr, defaultCron = '0 1 * * *') {
  if (!timeStr || !timeStr.includes(':')) return defaultCron;
  const parts = timeStr.trim().split(':');
  const minute = parseInt(parts[1], 10) || 0;
  const hour = parseInt(parts[0], 10) || 1;
  return `${minute} ${hour} * * *`;
}

async function initScheduler() {
  stopScheduler();

  // 1. Lifecycle Archive Cron (Default jam 01.00 WIB)
  let archiveCronExpr = '0 1 * * *';
  try {
    const { rows: tRows } = await pool.query("SELECT value FROM settings WHERE key = 'archive_lifecycle_time'");
    archiveCronExpr = convertTimeToCron(tRows[0]?.value, '0 1 * * *');
  } catch (err) {
    console.warn('Gagal membaca setting archive_lifecycle_time:', err.message);
  }

  try {
    archiveTask = cron.schedule(archiveCronExpr, async () => {
      console.log(`[Cron ${new Date().toISOString()}] Menjalankan Lifecycle Rule Arsip Otomatis...`);
      try {
        const res = await runArchiveLifecycle();
        console.log(`[Cron Arsip Selesai] Total: ${res.total}, Sukses: ${res.success}, Gagal: ${res.failed}`);
        cleanOldCache(2);
      } catch (err) {
        console.error('[Cron Arsip Error]', err.message);
      }
    });
    console.log(`⏰ Scheduler Arsip aktif: ${archiveCronExpr}`);
  } catch (e) {
    console.error('Gagal setup cron arsip:', e.message);
  }

  // 2. Backup Otomatis Harian Cron (Default jam 01.30 WIB)
  let backupCronExpr = '30 1 * * *';
  try {
    const { rows: bRows } = await pool.query("SELECT value FROM settings WHERE key = 'backup_time'");
    backupCronExpr = convertTimeToCron(bRows[0]?.value, '30 1 * * *');
  } catch (err) {
    console.warn('Gagal membaca setting backup_time:', err.message);
  }

  try {
    backupTask = cron.schedule(backupCronExpr, async () => {
      try {
        const { rows: enRows } = await pool.query("SELECT value FROM settings WHERE key = 'backup_enabled'");
        if (enRows[0] && enRows[0].value === '0') return;

        console.log(`[Cron ${new Date().toISOString()}] Menjalankan Backup Harian Otomatis...`);
        const b = await createFullBackup('scheduler', 'daily');
        console.log(`[Cron Backup Selesai] File: ${b.filename}, Ukuran: ${b.size}`);
      } catch (err) {
        console.error('[Cron Backup Error]', err.message);
      }
    });
    console.log(`⏰ Scheduler Backup aktif: ${backupCronExpr}`);
  } catch (e) {
    console.error('Gagal setup cron backup:', e.message);
  }
}

function stopScheduler() {
  if (archiveTask) {
    archiveTask.stop();
    archiveTask = null;
  }
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }
}

function restartScheduler() {
  initScheduler();
}

module.exports = {
  initScheduler,
  stopScheduler,
  restartScheduler,
};
