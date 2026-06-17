import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import os from 'os';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/authRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import pertandinganRoutes from './routes/pertandinganRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import bayaranRoutes from './routes/bayaranRoutes.js';
import bantuanRoutes from './routes/bantuanRoutes.js';
import acaraRoutes from './routes/acaraRoutes.js';
import kedaiRoutes from './routes/kedaiRoutes.js';
import kewanganRoutes from './routes/kewanganRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';


import eventBus from './utils/eventEmitter.js';
import { requestLogger, errorLogger } from './middleware/logMiddleware.js';
import { segerakSemuaPending } from './utils/paymentSync.js';
import db from './config/db.js';

// Tambah kolum baru jika belum wujud (safe — tidak akan overwrite data sedia ada)
const runMigrations = async () => {
    const migrations = [
        `ALTER TABLE bantuan_kebajikan ADD COLUMN IF NOT EXISTS sebab_tolak TEXT DEFAULT NULL`,
        `ALTER TABLE bantuan_kebajikan ADD COLUMN IF NOT EXISTS catatan_admin TEXT DEFAULT NULL`,
        `ALTER TABLE bantuan_kebajikan ADD COLUMN IF NOT EXISTS diproses_oleh VARCHAR(20) DEFAULT NULL`,
        `ALTER TABLE bantuan_kebajikan ADD COLUMN IF NOT EXISTS tarikh_dikemukakan DATETIME DEFAULT NULL`,
        `ALTER TABLE bantuan_kebajikan ADD COLUMN IF NOT EXISTS tarikh_keputusan DATETIME DEFAULT NULL`,
    ];
    for (const sql of migrations) {
        try { await db.query(sql); } catch (e) { /* kolum mungkin sudah wujud */ }
    }
    console.log('[Migration] bantuan_kebajikan: kolum kebajikan disemak.');
};

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// Security headers. crossOriginResourcePolicy dilonggar supaya fail upload (gambar/PDF)
// dalam /public boleh dimuat dari domain frontend yang berlainan.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// 1. FIX: Definisikan pembolehubah totalRequests supaya tidak ralat
let totalRequests = 0;

app.use((req, res, next) => {
    console.log(`[API REQ] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    totalRequests++; 
    next();
});

const allowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.STAGING_URL,
    // Web dev
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    // Capacitor Android (androidScheme: https → https://localhost)
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Benarkan request tanpa origin (Android WebView, Postman, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' tidak dibenarkan.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

// Handle preflight OPTIONS untuk SEMUA route (wajib untuk DELETE/PUT dengan Authorization header)
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json());
app.use(requestLogger);

// Uploads: nama fail unik (timestamp) — selamat cache 1 tahun
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
    maxAge: '365d',
    immutable: true,
    etag: false,
    lastModified: false,
}));

// Fail statik lain
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        }
    },
}));

// Hadkan percubaan pada laluan auth untuk elak brute-force (login/register/forgot/reset)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minit
    max: 20,                  // maksimum 20 permintaan setiap IP dalam tetingkap
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Terlalu banyak percubaan. Sila cuba lagi sebentar." }
});

// Laluan API
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ahli', memberRoutes);
app.use('/api/pertandingan', pertandinganRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes); // FIX: Ditukar kepada '/api/user' untuk elak konflik dengan memberRoutes
app.use('/api/bayaran', bayaranRoutes);
app.use('/api/bantuan', bantuanRoutes);
app.use('/api/acara', acaraRoutes);
app.use('/api/kedai', kedaiRoutes);
app.use('/api/admin/kewangan', kewanganRoutes);
app.use('/api/settings', settingsRoutes);

app.use(errorLogger);

const PORT = process.env.PORT || 5001;
app.listen(PORT, async () => {
    console.log(`🛸 AIGEO Core sedang berjalan di port ${PORT}`);
    await runMigrations();
});

// Penyegerakan berkala status bil PENDING (yuran + kedai) dengan ToyyibPay.
// Bertindak sebagai jaring keselamatan jika webhook gagal sampai, tanpa melambatkan permintaan API.
const SYNC_INTERVAL_MS = 3 * 60 * 1000; // setiap 3 minit
setInterval(() => {
    segerakSemuaPending().catch(e => console.error('[SYNC] Ralat tugas berkala:', e.message));
}, SYNC_INTERVAL_MS);