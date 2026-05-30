import express from 'express';
import { 
    bukaPertandingan, 
    senaraiPesertaPertandingan, 
    senaraiPertandinganAktif, 
    sertaiPertandingan 
} from '../controllers/pertandinganController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js'; // Mesti import ini untuk upload fail

const router = express.Router();

router.use(verifyToken);

// --- Laluan AHLI ---
router.get('/aktif', senaraiPertandinganAktif);
router.post('/daftar', sertaiPertandingan);

// --- Laluan URUSETIA (AJK Sahaja) ---
// Masukkan upload.single('poster') sebelum controller
router.post('/admin/buka', requireRole(['Admin', 'Super Admin']), upload.single('poster'), bukaPertandingan);
router.get('/admin/peserta/:id', requireRole(['Admin', 'Super Admin']), senaraiPesertaPertandingan);

export default router;