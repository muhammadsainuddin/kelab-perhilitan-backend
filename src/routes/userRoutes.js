import express from 'express';
import { 
    getMyProfile, 
    updateMyProfile, 
    applyResignation, 
    changePassword,
    updateGambarProfil,
    getSenaraiPTJ
} from '../controllers/userController.js';

import { verifyToken } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js'; // Pastikan multer dikonfigurasi dengan betul

const router = express.Router();

// 1. MEWAJIBKAN TOKEN UNTUK SEMUA LALUAN DI BAWAH
// Ini bermakna pengguna wajib log masuk (ada JWT) untuk mengakses fungsi di bawah
router.use(verifyToken);

// ==========================================
// 2. LALUAN PROFIL & AKAUN
// ==========================================

// getMyProfile: Menarik data profil dari jadual 'users' beserta semakan tunggakan yuran
router.get('/profil', getMyProfile);

// updateMyProfile: Mengemaskini maklumat peribadi, waris, dan perbankan terus ke jadual 'users'
router.put('/kemaskini-profil', updateMyProfile);

// updateGambarProfil: Memuat naik gambar profil menggunakan multer (menyimpan fail ke folder)
router.put('/kemaskini-gambar', upload.single('gambar'), updateGambarProfil);

// applyResignation: Merekodkan sebab berhenti dan menukar status_ahli kepada 'tidak aktif'
router.post('/mohon-berhenti', applyResignation);

// changePassword: Menukar kata laluan dengan pengesahan kata laluan lama
router.put('/tukar-password', changePassword);

// getSenaraiPTJ: Menarik senarai penempatan/lokasi dari jadual 'penempatan'
router.get('/senarai-ptj', getSenaraiPTJ);

export default router;