import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

// Dapatkan laluan direktori semasa (untuk ES Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tetapkan folder utama untuk muat naik fail (dalam public supaya boleh diakses UI)
const uploadDir = path.join(__dirname, '../public/uploads');

// Pastikan folder wujud. Jika tidak, cipta folder tersebut secara automatik.
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(path.join(uploadDir, 'images'))) fs.mkdirSync(path.join(uploadDir, 'images'));
if (!fs.existsSync(path.join(uploadDir, 'audio'))) fs.mkdirSync(path.join(uploadDir, 'audio'));
// TAMBAHAN BARU: Folder untuk dokumen permohonan bantuan (PDF)
if (!fs.existsSync(path.join(uploadDir, 'bantuan'))) fs.mkdirSync(path.join(uploadDir, 'bantuan')); 


// Konfigurasi storan (Di mana dan apa nama fail disimpan)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Asingkan folder mengikut jenis fail
        if (file.mimetype.startsWith('image/')) {
            cb(null, path.join(uploadDir, 'images'));
        } else if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
            cb(null, path.join(uploadDir, 'audio'));
        } else if (file.mimetype === 'application/pdf') {
            // TAMBAHAN BARU: Hala ke folder bantuan jika format PDF
            cb(null, path.join(uploadDir, 'bantuan')); 
        } else {
            cb(null, uploadDir); 
        }
    },
    filename: (req, file, cb) => {
        // Asingkan prefix nama fail
        let prefix = 'FILE';
        if (file.mimetype.startsWith('image/')) prefix = 'IMG';
        else if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) prefix = 'AUD';
        else if (file.mimetype === 'application/pdf') prefix = 'DOC'; // TAMBAHAN BARU
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${prefix}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

// Senarai putih sambungan fail yang dibenarkan (SVG sengaja DITOLAK — risiko XSS bila disajikan statik)
const allowedExt = [
    '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp',  // gambar (jfif = jpeg)
    '.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.webm',    // audio/video
    '.pdf'                                              // dokumen
];

// Penapis fail: sahkan KEDUA-DUA mimetype DAN sambungan fail (mimetype boleh dipalsukan klien)
const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk =
        file.mimetype.startsWith('image/') ||
        file.mimetype.startsWith('audio/') ||
        file.mimetype.startsWith('video/') ||
        file.mimetype === 'application/pdf';

    if (mimeOk && file.mimetype !== 'image/svg+xml' && allowedExt.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Format fail tidak disokong. Gunakan gambar (JPG, JFIF, PNG, WEBP), audio/video, atau PDF sahaja.'), false);
    }
};

// Cipta middleware upload
export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 } // Had saiz fail: 20MB kekal sama
});

// ──────────────────────────────────────────────────────────────
// Pembungkus upload.array yang menukar ralat multer kepada JSON 400
// (supaya frontend dapat papar notifikasi jelas, bukan 500 tanpa mesej)
// ──────────────────────────────────────────────────────────────
export const uploadGambar = (field, max) => (req, res, next) => {
    upload.array(field, max)(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE'
                ? 'Saiz fail terlalu besar (maksimum 20MB).'
                : (err.message || 'Muat naik fail gagal.');
            return res.status(400).json({ success: false, message: msg });
        }
        next();
    });
};

// ──────────────────────────────────────────────────────────────
// Middleware: mampatkan & normalkan gambar selepas dimuat naik.
// Semua gambar (termasuk JFIF/PNG/WEBP) ditukar kepada JPEG termampat
// untuk jimat ruang server. Dijalankan SELEPAS multer, SEBELUM controller.
// ──────────────────────────────────────────────────────────────
export const mampatGambar = async (req, res, next) => {
    if (!req.files || req.files.length === 0) return next();
    try {
        for (const f of req.files) {
            if (!f.mimetype || !f.mimetype.startsWith('image/') || f.mimetype === 'image/gif') continue;
            const dir = path.dirname(f.path);
            const namaBaru = path.basename(f.filename, path.extname(f.filename)) + '.jpg';
            const laluanBaru = path.join(dir, namaBaru);

            const buffer = await sharp(f.path)
                .rotate() // hormati orientasi EXIF
                .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 75, mozjpeg: true })
                .toBuffer();

            await fs.promises.writeFile(laluanBaru, buffer);
            if (laluanBaru !== f.path) await fs.promises.unlink(f.path).catch(() => {});

            f.filename = namaBaru;
            f.path = laluanBaru;
            f.mimetype = 'image/jpeg';
            f.size = buffer.length;
        }
        next();
    } catch (e) {
        console.error('[UPLOAD] mampatGambar:', e.message);
        next(); // jangan blok proses; guna fail asal jika mampatan gagal
    }
};