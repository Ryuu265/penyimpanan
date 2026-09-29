const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const driveRoute = require('./drive');
const {
  getHotStoragePath,
  ensureDirSync,
  sanitizePathSegment,
  calculateChecksum
} = require('../services/storageService');

// In-memory status tracking untuk background import jobs
const importJobs = new Map();

// Helper untuk membersihkan job lama (> 1 jam)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of importJobs.entries()) {
    if (job.createdAt < oneHourAgo) {
      importJobs.delete(id);
    }
  }
}, 600000);

// Helper ekstrak Google Drive ID dari URL atau ID mentah
function extractDriveId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const folderMatch = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { id: folderMatch[1], type: 'folder' };

  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return { id: fileMatch[1], type: 'file' };

  const idMatch = trimmed.match(/id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return { id: idMatch[1], type: 'unknown' };

  // Jika string hanya alphanumeric ID
  if (/^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) {
    return { id: trimmed, type: 'unknown' };
  }

  return null;
}

// POST /api/gdrive-import/inspect - Cek URL / ID Google Drive & tampilkan detail sebelum disalin
router.post('/inspect', verifyToken, async (req, res) => {
  const { drive_url_or_id } = req.body;
  if (!drive_url_or_id) {
    return res.status(400).json({ error: 'URL atau ID Google Drive wajib diisi.' });
  }

  const parsed = extractDriveId(drive_url_or_id);
  if (!parsed) {
    return res.status(400).json({ error: 'Format link Google Drive tidak valid.' });
  }

  const drive = driveRoute.getDriveClient ? driveRoute.getDriveClient() : null;
  if (!drive) {
    return res.status(503).json({
      error: 'Google Drive API belum terkonfigurasi. Hubungkan service account key di server.',
      service_account: driveRoute.SERVICE_ACCOUNT_EMAIL
    });
  }

  try {
    const meta = await drive.files.get({
      fileId: parsed.id,
      fields: 'id, name, mimeType, size, modifiedTime',
      supportsAllDrives: true,
    });

    const isFolder = meta.data.mimeType === 'application/vnd.google-apps.folder';
    let fileCount = 0;
    let sampleFiles = [];

    if (isFolder) {
      const listRes = await drive.files.list({
        q: `'${parsed.id}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size)',
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      sampleFiles = listRes.data.files || [];
      fileCount = sampleFiles.length;
    }

    res.json({
      success: true,
      id: meta.data.id,
      name: meta.data.name,
      isFolder,
      mimeType: meta.data.mimeType,
      size: meta.data.size || 0,
      fileCount,
      sampleFiles,
    });
  } catch (err) {
    return res.status(400).json({
      error: 'Gagal mengakses Google Drive: ' + err.message,
      hint: 'Pastikan file/folder telah dibagikan ke email Service Account: ' + driveRoute.SERVICE_ACCOUNT_EMAIL
    });
  }
});

// Stream download helper dari Google Drive ke disk lokal
async function downloadDriveFile(drive, fileMeta, targetFilePath) {
  ensureDirSync(path.dirname(targetFilePath));
  const writeStream = fs.createWriteStream(targetFilePath);

  const isGoogleDoc = fileMeta.mimeType === 'application/vnd.google-apps.document';
  const isGoogleSheet = fileMeta.mimeType === 'application/vnd.google-apps.spreadsheet';
  const isGoogleSlide = fileMeta.mimeType === 'application/vnd.google-apps.presentation';

  if (isGoogleDoc) {
    // Export Docs to PDF
    const response = await drive.files.export({
      fileId: fileMeta.id,
      mimeType: 'application/pdf',
    }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(writeStream).on('finish', resolve).on('error', reject);
    });
    return { exported: true, mimeType: 'application/pdf', ext: '.pdf' };
  } else if (isGoogleSheet) {
    // Export Sheet to XLSX
    const response = await drive.files.export({
      fileId: fileMeta.id,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(writeStream).on('finish', resolve).on('error', reject);
    });
    return { exported: true, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' };
  } else if (isGoogleSlide) {
    // Export Slide to PDF
    const response = await drive.files.export({
      fileId: fileMeta.id,
      mimeType: 'application/pdf',
    }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(writeStream).on('finish', resolve).on('error', reject);
    });
    return { exported: true, mimeType: 'application/pdf', ext: '.pdf' };
  } else {
    // Binary regular file
    const response = await drive.files.get({
      fileId: fileMeta.id,
      alt: 'media',
      supportsAllDrives: true,
    }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.pipe(writeStream).on('finish', resolve).on('error', reject);
    });
    return { exported: false, mimeType: fileMeta.mimeType, ext: path.extname(fileMeta.name) };
  }
}

// POST /api/gdrive-import/copy - Salin item (file atau folder) dari Google Drive ke server lokal
router.post('/copy', verifyToken, async (req, res) => {
  const {
    drive_url_or_id,
    bidang_id,
    tahapan_id,
    folder_name
  } = req.body;

  if (!drive_url_or_id) {
    return res.status(400).json({ error: 'URL atau ID Google Drive wajib diisi.' });
  }

  if (!bidang_id) {
    return res.status(400).json({ error: 'bidang_id wajib diisi.' });
  }

  // Hak akses
  if (req.user.role === 'ADMIN_BIDANG' && req.user.bidang_id !== bidang_id) {
    return res.status(403).json({ error: 'Anda hanya dapat mengimpor file ke bidang Anda sendiri.' });
  }

  const parsed = extractDriveId(drive_url_or_id);
  if (!parsed) {
    return res.status(400).json({ error: 'Format link Google Drive tidak valid.' });
  }

  const drive = driveRoute.getDriveClient ? driveRoute.getDriveClient() : null;
  if (!drive) {
    return res.status(503).json({
      error: 'Google Drive API belum terkonfigurasi. Hubungkan service account key di server.'
    });
  }

  try {
    // Dapatkan info bidang & tahun
    const { rows: bRows } = await pool.query(`
      SELECT b.*, t.nama AS tahun_nama
      FROM bidang b
      LEFT JOIN tahun t ON b.tahun_id = t.id
      WHERE b.id = $1
    `, [bidang_id]);
    const bidang = bRows[0];
    if (!bidang) return res.status(404).json({ error: 'Bidang tidak ditemukan.' });

    const tahunFolder = bidang.tahun_nama ? `Tahun_${sanitizePathSegment(bidang.tahun_nama)}` : 'Tahun_Umum';
    const bidangFolder = sanitizePathSegment(bidang.nama_bidang);
    let tahapanFolder = '';
    if (tahapan_id && tahapan_id !== 'umum') {
      const { rows: thpRows } = await pool.query('SELECT label FROM tahapan WHERE id = $1', [tahapan_id]);
      if (thpRows[0]) {
        tahapanFolder = `${sanitizePathSegment(thpRows[0].label)}_${tahapan_id}`;
      }
    }

    const jobId = 'job-' + uuidv4().slice(0, 8);
    const jobState = {
      id: jobId,
      status: 'processing',
      totalFiles: 0,
      copiedFiles: 0,
      failedFiles: 0,
      createdFiles: [],
      error: null,
      createdAt: Date.now()
    };
    importJobs.set(jobId, jobState);

    // Proses import secara asinkron agar request tidak timeout untuk folder besar
    (async () => {
      try {
        const meta = await drive.files.get({
          fileId: parsed.id,
          fields: 'id, name, mimeType, size',
          supportsAllDrives: true,
        });

        const isFolder = meta.data.mimeType === 'application/vnd.google-apps.folder';

        if (isFolder) {
          // Buat folder lokal di dalam tahapan jika ditentukan
          const targetFolderName = sanitizePathSegment(folder_name || meta.data.name);
          const folderSubdir = path.join(tahunFolder, bidangFolder, tahapanFolder, targetFolderName);
          const fullFolderDir = path.join(getHotStoragePath(), folderSubdir);
          ensureDirSync(fullFolderDir);

          // Catat folder ke local_folders jika belum ada
          if (tahapan_id && tahapan_id !== 'umum') {
            const { rows: exFld } = await pool.query(`
              SELECT id FROM local_folders WHERE tahapan_id = $1 AND LOWER(nama_folder) = LOWER($2)
            `, [tahapan_id, targetFolderName]);
            if (exFld.length === 0) {
              const folderId = 'lfol-' + uuidv4().slice(0, 8);
              await pool.query(`
                INSERT INTO local_folders (id, tahun_id, bidang_id, tahapan_id, nama_folder, relative_path, dibuat_oleh, user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              `, [folderId, bidang.tahun_id || null, bidang.id, tahapan_id, targetFolderName, folderSubdir, req.user.nama, req.user.id]);
            }
          }

          // Ambil daftar file dalam folder Drive
          const listRes = await drive.files.list({
            q: `'${parsed.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
            fields: 'files(id, name, mimeType, size)',
            pageSize: 100,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          });

          const filesToCopy = listRes.data.files || [];
          jobState.totalFiles = filesToCopy.length;

          for (const f of filesToCopy) {
            try {
              let finalName = f.name;
              const ext = path.extname(f.name);
              if (!ext) {
                if (f.mimeType === 'application/vnd.google-apps.document') finalName += '.pdf';
                else if (f.mimeType === 'application/vnd.google-apps.spreadsheet') finalName += '.xlsx';
                else if (f.mimeType === 'application/vnd.google-apps.presentation') finalName += '.pdf';
              }

              const cleanFileName = sanitizePathSegment(finalName);
              const storedName = `${Date.now()}_${cleanFileName}`;
              const targetFilePath = path.join(fullFolderDir, storedName);

              const downloadResult = await downloadDriveFile(drive, f, targetFilePath);
              const stats = fs.statSync(targetFilePath);
              const checksum = await calculateChecksum(targetFilePath);
              const relHotPath = path.join(folderSubdir, storedName);

              const fileId = 'loc-' + uuidv4().slice(0, 8);
              await pool.query(`
                INSERT INTO local_files (
                  id, tahun_id, bidang_id, tahapan_id, folder_path,
                  original_name, stored_name, mime_type, size, original_size,
                  location, hot_path, checksum, compressed, pinned, uploaded_by, user_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hot', $11, $12, 0, 0, $13, $14)
              `, [
                fileId, bidang.tahun_id || null, bidang.id, tahapan_id || null, targetFolderName,
                cleanFileName, storedName, downloadResult.mimeType || f.mimeType, stats.size, stats.size,
                relHotPath, checksum, `${req.user.nama} (Salin GDrive)`, req.user.id
              ]);

              jobState.copiedFiles++;
              jobState.createdFiles.push({ id: fileId, name: cleanFileName, size: stats.size });
            } catch (fileErr) {
              console.warn(`Gagal copy file ${f.name} dari GDrive:`, fileErr.message);
              jobState.failedFiles++;
            }
          }

          jobState.status = 'completed';
        } else {
          // Salin single file
          jobState.totalFiles = 1;
          const targetFolderName = folder_name ? sanitizePathSegment(folder_name) : '';
          const fileSubdir = path.join(tahunFolder, bidangFolder, tahapanFolder, targetFolderName);
          const fullDir = path.join(getHotStoragePath(), fileSubdir);
          ensureDirSync(fullDir);

          let finalName = meta.data.name;
          const ext = path.extname(meta.data.name);
          if (!ext) {
            if (meta.data.mimeType === 'application/vnd.google-apps.document') finalName += '.pdf';
            else if (meta.data.mimeType === 'application/vnd.google-apps.spreadsheet') finalName += '.xlsx';
            else if (meta.data.mimeType === 'application/vnd.google-apps.presentation') finalName += '.pdf';
          }

          const cleanFileName = sanitizePathSegment(finalName);
          const storedName = `${Date.now()}_${cleanFileName}`;
          const targetFilePath = path.join(fullDir, storedName);

          const downloadResult = await downloadDriveFile(drive, meta.data, targetFilePath);
          const stats = fs.statSync(targetFilePath);
          const checksum = await calculateChecksum(targetFilePath);
          const relHotPath = path.join(fileSubdir, storedName);

          const fileId = 'loc-' + uuidv4().slice(0, 8);
          await pool.query(`
            INSERT INTO local_files (
              id, tahun_id, bidang_id, tahapan_id, folder_path,
              original_name, stored_name, mime_type, size, original_size,
              location, hot_path, checksum, compressed, pinned, uploaded_by, user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hot', $11, $12, 0, 0, $13, $14)
          `, [
            fileId, bidang.tahun_id || null, bidang.id, tahapan_id || null, targetFolderName,
            cleanFileName, storedName, downloadResult.mimeType || meta.data.mimeType, stats.size, stats.size,
            relHotPath, checksum, `${req.user.nama} (Salin GDrive)`, req.user.id
          ]);

          jobState.copiedFiles = 1;
          jobState.createdFiles.push({ id: fileId, name: cleanFileName, size: stats.size });
          jobState.status = 'completed';
        }

        // Catat log aktivitas
        await pool.query(`
          INSERT INTO activity_logs (id, user_id, user_nama, aksi, detail)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          uuidv4(),
          req.user.id,
          req.user.nama,
          'SALIN_GDRIVE_KE_LOKAL',
          `Menyalin ${jobState.copiedFiles} file dari Google Drive (${meta.data.name}) ke server lokal`
        ]);

      } catch (jobErr) {
        console.error('GDrive Import job error:', jobErr.message);
        jobState.status = 'failed';
        jobState.error = jobErr.message;
      }
    })();

    res.status(202).json({
      message: 'Proses penyalinan dari Google Drive telah dimulai.',
      jobId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// GET /api/gdrive-import/job/:jobId - Cek status proses salin
router.get('/job/:jobId', verifyToken, (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job tidak ditemukan atau telah kedaluwarsa.' });
  }
  res.json({ job });
});

module.exports = router;
