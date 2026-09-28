const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');

// Konfigurasi path dari environment variable (.env)
function getHotStoragePath() {
  const p = process.env.HOT_STORAGE_PATH || './storage/hot';
  return path.resolve(process.cwd(), p);
}

function getArchiveStoragePath() {
  const p = process.env.ARCHIVE_STORAGE_PATH || './storage/archive';
  return path.resolve(process.cwd(), p);
}

function getBackupStoragePath() {
  const p = process.env.BACKUP_STORAGE_PATH || './storage/backup';
  return path.resolve(process.cwd(), p);
}

function getCacheStoragePath() {
  const p = process.env.CACHE_STORAGE_PATH || './storage/cache';
  return path.resolve(process.cwd(), p);
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Inisialisasi semua direktori penyimpanan lokal
function initStorageDirs() {
  ensureDirSync(getHotStoragePath());
  ensureDirSync(getArchiveStoragePath());
  ensureDirSync(getBackupStoragePath());
  ensureDirSync(getCacheStoragePath());
}

// Hitung SHA-256 checksum dari file
function calculateChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

// Zip satu file ke file .zip target
function zipSingleFile(sourceFilePath, targetZipPath, entryName) {
  return new Promise((resolve, reject) => {
    ensureDirSync(path.dirname(targetZipPath));
    const output = fs.createWriteStream(targetZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve({ totalBytes: archive.pointer() }));
    archive.on('error', err => reject(err));

    archive.pipe(output);
    archive.file(sourceFilePath, { name: entryName || path.basename(sourceFilePath) });
    archive.finalize();
  });
}

// Ekstrak file zip ke folder target
async function extractZip(zipFilePath, targetDir) {
  ensureDirSync(targetDir);
  const directory = await unzipper.Open.file(zipFilePath);
  await directory.extract({ path: targetDir });
}

// Buat zip dari daftar file lokal (dengan struktur folder preserved)
function zipFilesStream(fileList, res, zipFileName = 'archive.zip') {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal membuat file ZIP: ' + err.message });
    }
  });

  archive.pipe(res);

  for (const item of fileList) {
    if (fs.existsSync(item.filePath)) {
      archive.file(item.filePath, { name: item.zipPath });
    }
  }

  return archive.finalize();
}

// Pembersihan cache otomatis (misal file cache yang umurnya > maxDays hari)
// Pembersihan cache otomatis (misal file cache yang umurnya > maxDays hari)
function cleanOldCache(maxDays = 2) {
  const cacheDir = getCacheStoragePath();
  if (!fs.existsSync(cacheDir)) return;

  const now = Date.now();
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;

  try {
    const files = fs.readdirSync(cacheDir);
    for (const f of files) {
      const full = path.join(cacheDir, f);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > maxAgeMs) {
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
      }
    }
  } catch (err) {
    console.warn('Gagal membersihkan cache lama:', err.message);
  }
}

// Kompresi ukuran gambar (JPG, PNG, WebP) dan PDF secara fisik
async function compressMediaFile(filePath, mimeType = '') {
  if (!fs.existsSync(filePath)) {
    throw new Error('File tidak ditemukan.');
  }

  const statBefore = fs.statSync(filePath);
  const originalSize = statBefore.size;
  const ext = path.extname(filePath).toLowerCase();

  let compressedBuffer = null;

  try {
    // 1. Gambar JPG / JPEG
    if (['.jpg', '.jpeg'].includes(ext) || mimeType.includes('jpeg')) {
      const sharp = require('sharp');
      compressedBuffer = await sharp(filePath)
        .jpeg({ quality: 75, progressive: true, mozjpeg: true })
        .toBuffer();
    }
    // 2. Gambar PNG
    else if (ext === '.png' || mimeType.includes('png')) {
      const sharp = require('sharp');
      compressedBuffer = await sharp(filePath)
        .png({ compressionLevel: 8, adaptiveFiltering: true, quality: 80 })
        .toBuffer();
    }
    // 3. Gambar WebP
    else if (ext === '.webp' || mimeType.includes('webp')) {
      const sharp = require('sharp');
      compressedBuffer = await sharp(filePath)
        .webp({ quality: 75 })
        .toBuffer();
    }
    // 4. Dokumen PDF
    else if (ext === '.pdf' || mimeType.includes('pdf')) {
      const { PDFDocument } = require('pdf-lib');
      const existingPdfBytes = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes, { ignoreEncryption: true });
      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      compressedBuffer = Buffer.from(pdfBytes);
    }
  } catch (err) {
    console.warn(`[compressMediaFile] Gagal mengompres ${filePath}:`, err.message);
    return {
      compressed: false,
      originalSize,
      newSize: originalSize,
      savedBytes: 0,
      percentSaved: 0,
      reason: err.message
    };
  }

  // Jika hasil kompresi ada dan ukurannya LEBIH KECIL dari file asli
  if (compressedBuffer && compressedBuffer.length < originalSize) {
    fs.writeFileSync(filePath, compressedBuffer);
    const newSize = compressedBuffer.length;
    const savedBytes = originalSize - newSize;
    const percentSaved = Math.round((savedBytes / originalSize) * 100);

    return {
      compressed: true,
      originalSize,
      newSize,
      savedBytes,
      percentSaved
    };
  }

  return {
    compressed: false,
    originalSize,
    newSize: originalSize,
    savedBytes: 0,
    percentSaved: 0,
    reason: 'Ukuran file sudah optimal.'
  };
}

// Dapatkan statistik kapasitas disk (estimasi ukuran direktori)
function getDirectorySize(dirPath) {
  let total = 0;
  let fileCount = 0;
  if (!fs.existsSync(dirPath)) return { totalBytes: 0, fileCount: 0 };

  function recurse(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          recurse(full);
        } else if (ent.isFile()) {
          const stat = fs.statSync(full);
          total += stat.size;
          fileCount++;
        }
      }
    } catch (_) {}
  }

  recurse(dirPath);
  return { totalBytes: total, fileCount };
}

// Dapatkan kapasitas disk fisik / partisi server menggunakan statfs
function getDiskCapacity(targetPath = '.') {
  try {
    const stat = fs.statfsSync(targetPath);
    const totalBytes = stat.bsize * stat.blocks;
    const freeBytes = stat.bsize * stat.bfree;
    const usedBytes = totalBytes - freeBytes;
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    const isAlmostFull = usedPercent >= 85;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
      isAlmostFull,
      warning: isAlmostFull ? `Peringatan: Kapasitas disk server telah mencapai ${usedPercent}%!` : null
    };
  } catch (err) {
    return {
      totalBytes: 0,
      freeBytes: 0,
      usedBytes: 0,
      usedPercent: 0,
      isAlmostFull: false,
      warning: null
    };
  }
}

module.exports = {
  getHotStoragePath,
  getArchiveStoragePath,
  getBackupStoragePath,
  getCacheStoragePath,
  ensureDirSync,
  initStorageDirs,
  calculateChecksum,
  zipSingleFile,
  extractZip,
  zipFilesStream,
  cleanOldCache,
  compressMediaFile,
  getDirectorySize,
  getDiskCapacity,
};
