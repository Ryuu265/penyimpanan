const http = require('http');
const pool = require('../db');

let timerInterval = null;
let isPinging = false;

// Ambil konfigurasi saat ini dari PostgreSQL
async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return {
    active: map.keepalive_active === '1' || map.keepalive_active === 'true',
    interval_minutes: parseInt(map.keepalive_interval || '10', 10),
    schedule_enabled: map.keepalive_schedule_enabled === '1' || map.keepalive_schedule_enabled === 'true',
    work_start: map.keepalive_work_start || '08:00',
    work_end: map.keepalive_work_end || '17:00',
    last_ping: map.keepalive_last_ping || null,
    last_status: map.keepalive_last_status || 'Belum ada ping',
    ping_count: parseInt(map.keepalive_ping_count || '0', 10),
  };
}

// Simpan konfigurasi ke PostgreSQL
async function setSetting(key, value) {
  await pool.query(`
    INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, String(value)]);
}

async function updateConfig({ active, interval_minutes, schedule_enabled, work_start, work_end }) {
  if (active !== undefined) {
    await setSetting('keepalive_active', active ? '1' : '0');
  }
  if (interval_minutes !== undefined) {
    await setSetting('keepalive_interval', Math.max(1, parseInt(interval_minutes, 10) || 10));
  }
  if (schedule_enabled !== undefined) {
    await setSetting('keepalive_schedule_enabled', schedule_enabled ? '1' : '0');
  }
  if (work_start !== undefined) {
    await setSetting('keepalive_work_start', work_start);
  }
  if (work_end !== undefined) {
    await setSetting('keepalive_work_end', work_end);
  }
  return await getStatus();
}

function isWithinWorkHours(startTimeStr, endTimeStr) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (startTimeStr || '08:00').split(':').map(Number);
  const [endH, endM] = (endTimeStr || '17:00').split(':').map(Number);

  const startTotal = (startH || 0) * 60 + (startM || 0);
  const endTotal = (endH || 0) * 60 + (endM || 0);

  if (startTotal <= endTotal) {
    return currentMinutes >= startTotal && currentMinutes < endTotal;
  } else {
    // Range melewati tengah malam (misal 22:00 - 05:00)
    return currentMinutes >= startTotal || currentMinutes < endTotal;
  }
}

// Eksekusi request ringan ke endpoint health server lokal
function performPing(isManual = false) {
  return new Promise((resolve) => {
    if (isPinging) return resolve({ success: false, message: 'Ping sedang berjalan' });
    isPinging = true;

    const port = process.env.PORT || 3001;
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/api/health',
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', async () => {
        isPinging = false;
        const nowIso = new Date().toISOString();
        try {
          const settings = await getSettings();
          const newCount = settings.ping_count + 1;
          const statusMsg = `Berhasil (${res.statusCode} OK)${isManual ? ' [Manual]' : ''}`;

          await setSetting('keepalive_last_ping', nowIso);
          await setSetting('keepalive_last_status', statusMsg);
          await setSetting('keepalive_ping_count', newCount);

          console.log(`[KeepAlive] 💓 Self-ping berhasil (${nowIso}) - Status: ${res.statusCode} - Total: ${newCount}`);
          resolve({ success: true, timestamp: nowIso, statusCode: res.statusCode, count: newCount });
        } catch (e) {
          resolve({ success: true, timestamp: nowIso, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', async (err) => {
      isPinging = false;
      const nowIso = new Date().toISOString();
      const statusMsg = `Gagal: ${err.message}${isManual ? ' [Manual]' : ''}`;

      try {
        await setSetting('keepalive_last_ping', nowIso);
        await setSetting('keepalive_last_status', statusMsg);
      } catch (e) {}

      console.warn(`[KeepAlive] ⚠️ Self-ping error:`, err.message);
      resolve({ success: false, timestamp: nowIso, error: err.message });
    });

    req.on('timeout', async () => {
      req.destroy();
      isPinging = false;
      const nowIso = new Date().toISOString();
      const statusMsg = `Timeout (5s)${isManual ? ' [Manual]' : ''}`;

      try {
        await setSetting('keepalive_last_ping', nowIso);
        await setSetting('keepalive_last_status', statusMsg);
      } catch (e) {}

      console.warn(`[KeepAlive] ⚠️ Self-ping timeout.`);
      resolve({ success: false, timestamp: nowIso, error: 'Timeout' });
    });

    req.end();
  });
}

async function getStatus() {
  const config = await getSettings();
  const inWorkHours = isWithinWorkHours(config.work_start, config.work_end);
  let effectiveRunning = false;
  let reason = '';

  if (!config.active) {
    effectiveRunning = false;
    reason = 'Dinonaktifkan secara manual oleh Admin';
  } else if (config.schedule_enabled && !inWorkHours) {
    effectiveRunning = false;
    reason = `Di luar jam kerja (${config.work_start} - ${config.work_end})`;
  } else {
    effectiveRunning = true;
    reason = config.schedule_enabled ? `Aktif dalam jam kerja (${config.work_start} - ${config.work_end})` : 'Aktif (24 Jam / Selalu Hidup)';
  }

  return {
    ...config,
    in_work_hours: inWorkHours,
    effective_running: effectiveRunning,
    status_summary: reason,
    current_time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

// Tick runner yang dipanggil setiap menit
async function checkAndRunTick() {
  try {
    const status = await getStatus();
    if (!status.effective_running) {
      return;
    }

    const lastPingTime = status.last_ping ? new Date(status.last_ping).getTime() : 0;
    const now = Date.now();
    const intervalMs = (status.interval_minutes || 10) * 60 * 1000;

    if (now - lastPingTime >= intervalMs) {
      await performPing(false);
    }
  } catch (err) {
    console.error('[KeepAlive] Error during tick:', err.message);
  }
}

function init() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  console.log('⚡ KeepAlive Service diinisialisasi (Interval check: 60 detik)');
  
  // Eksekusi tick pertama kali setelah 5 detik server siap
  setTimeout(() => {
    checkAndRunTick();
  }, 5000);

  // Interval check setiap 60 detik
  timerInterval = setInterval(checkAndRunTick, 60 * 1000);
}

module.exports = {
  init,
  getStatus,
  updateConfig,
  performPing,
};
