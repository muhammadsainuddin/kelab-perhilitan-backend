import db from '../config/db.js';
import jwt from 'jsonwebtoken';

let cache = { aktif: false, dikemaskini: 0 };
const TTL = 30_000; // 30 saat

export const bacaStatusMaintenance = async () => {
    const kini = Date.now();
    if (kini - cache.dikemaskini < TTL) return cache.aktif;
    try {
        const [[row]] = await db.query(
            `SELECT nilai FROM tetapan_sistem WHERE kunci = 'maintenance_mode'`
        );
        cache.aktif = row?.nilai === 1;
    } catch { cache.aktif = false; }
    cache.dikemaskini = Date.now();
    return cache.aktif;
};

// Panggil ini setiap kali maintenance_mode diubah supaya berkesan serta-merta
export const invalidateMaintenanceCache = () => { cache.dikemaskini = 0; };

const LALUAN_BEBAS = ['/api/auth', '/api/public'];
const PERANAN_ADMIN = ['Admin', 'Super Admin'];

export const maintenanceGuard = async (req, res, next) => {
    if (LALUAN_BEBAS.some(p => req.path.startsWith(p))) return next();

    const aktif = await bacaStatusMaintenance();
    if (!aktif) return next();

    // Maintenance ON — admin boleh teruskan
    try {
        const header = req.headers.authorization;
        if (header?.startsWith('Bearer ')) {
            const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
            if (PERANAN_ADMIN.includes(decoded.role)) return next();
        }
    } catch {}

    res.status(503).json({
        maintenance: true,
        message: 'Sistem sedang dalam penyelenggaraan. Sila cuba sebentar lagi.'
    });
};
