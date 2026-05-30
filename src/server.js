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


import eventBus from './utils/eventEmitter.js';
import { requestLogger, errorLogger } from './middleware/logMiddleware.js';
import { segerakSemuaPending } from './utils/paymentSync.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
].filter(Boolean);

// 2. FIX: Permudahkan tetapan CORS dengan memasukkan array terus
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(requestLogger);

// Sajikan folder statik
app.use(express.static(path.join(__dirname, 'public')));

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

app.use(errorLogger);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🛸 AIGEO Core sedang berjalan di port ${PORT}`));

// Penyegerakan berkala status bil PENDING (yuran + kedai) dengan ToyyibPay.
// Bertindak sebagai jaring keselamatan jika webhook gagal sampai, tanpa melambatkan permintaan API.
const SYNC_INTERVAL_MS = 3 * 60 * 1000; // setiap 3 minit
setInterval(() => {
    segerakSemuaPending().catch(e => console.error('[SYNC] Ralat tugas berkala:', e.message));
}, SYNC_INTERVAL_MS);