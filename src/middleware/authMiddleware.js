import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Middleware untuk memastikan pengguna telah log masuk (valid JWT)
 */
export const verifyToken = (req, res, next) => {
    // Dapatkan token dari header 'Authorization: Bearer <token>'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Akses ditolak. Token tidak ditemui." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        // Token luput atau tidak sah → 401 (bukan 403) supaya frontend boleh auto-logout
        return res.status(401).json({ message: "Sesi tamat. Sila log masuk semula." });
    }
};

/**
 * Middleware untuk Role-Based Access Control (RBAC)
 * @param {Array} roles - Senarai peranan yang dibenarkan (cth: ['Admin', 'Penyelia'])
 */
export const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ 
                message: "Akses dilarang. Anda tiada kebenaran untuk tindakan ini." 
            });
        }
        next();
    };
};