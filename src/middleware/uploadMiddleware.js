import multer from 'multer';
import path from 'path';
import fs from 'fs';
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

// Penapis fail (Terima gambar, audio, video dan PDF sahaja)
const fileFilter = (req, file, cb) => {
    if (
        file.mimetype.startsWith('image/') || 
        file.mimetype.startsWith('audio/') || 
        file.mimetype.startsWith('video/') ||
        file.mimetype === 'application/pdf' // TAMBAHAN BARU: Benarkan PDF
    ) {
        cb(null, true);
    } else {
        cb(new Error('Format fail tidak disokong. Sila muat naik gambar, audio/video atau dokumen PDF sahaja.'), false);
    }
};

// Cipta middleware upload
export const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 } // Had saiz fail: 20MB kekal sama
});