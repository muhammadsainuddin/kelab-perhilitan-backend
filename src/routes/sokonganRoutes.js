// ============================================================
// FAIL: src/routes/sokonganRoutes.js
// Sistem Tiket Sokongan — Ahli + Admin
// ============================================================
import express from 'express';
import {
    getSenaraiTiketAhli, hantarTiketBaru, getDetailTiketAhli, balasTiketAhli,
    getSenaraiTiketAdmin, getDetailTiketAdmin, balasTiketAdmin, kemaskiniStatusTiket,
} from '../controllers/sokonganController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// ── Ahli (semua yang log masuk) ──────────────────────────────
router.get('/',          verifyToken, getSenaraiTiketAhli);
router.post('/',         verifyToken, hantarTiketBaru);
router.get('/:id',       verifyToken, getDetailTiketAhli);
router.post('/:id/balas', verifyToken, balasTiketAhli);

// ── Admin ────────────────────────────────────────────────────
const adminGuard = [verifyToken, requireRole(['Admin', 'Super Admin', 'Bendahari'])];
router.get('/admin/senarai',          ...adminGuard, getSenaraiTiketAdmin);
router.get('/admin/:id',              ...adminGuard, getDetailTiketAdmin);
router.post('/admin/:id/balas',       ...adminGuard, balasTiketAdmin);
router.put('/admin/:id/status',       ...adminGuard, kemaskiniStatusTiket);

export default router;
