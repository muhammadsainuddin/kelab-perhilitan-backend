import express from 'express';
import {
    getMyProfile,
    updateMyProfile,
    applyResignation,
    getStatusBerhenti,
    changePassword,
    updateGambarProfil,
    getSenaraiPTJ,
    hubungiKelab
} from '../controllers/userController.js';

import {
    senaraiKempenAktif,
    rekodSumbangan,
    buatBilSumbanganFPX,
    kempenSayaSebagaiPenerima,
    senaraiNotifikasi,
    tandaBacaNotifikasi,
    bilanganNotifikasiBelumBaca
} from '../controllers/sumbanganController.js';

import { verifyToken } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';

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

router.get('/status-berhenti', getStatusBerhenti);
router.post('/mohon-berhenti', applyResignation);

// changePassword: Menukar kata laluan dengan pengesahan kata laluan lama
router.put('/tukar-password', changePassword);

// getSenaraiPTJ: Menarik senarai penempatan/lokasi dari jadual 'penempatan'
router.get('/senarai-ptj', getSenaraiPTJ);

// hubungiKelab: Ahli hantar pertanyaan / permohonan bantuan melalui emel
router.post('/hubungi-kelab', hubungiKelab);

// ==========================================
// KEMPEN SUMBANGAN
// ==========================================
router.get('/kempen-sumbangan',                         senaraiKempenAktif);
router.get('/kempen-sumbangan/saya-penerima',           kempenSayaSebagaiPenerima);
router.post('/kempen-sumbangan/:kempen_id/rekod',       rekodSumbangan);
router.post('/kempen-sumbangan/:kempen_id/bayar-fpx',   buatBilSumbanganFPX);

// ==========================================
// NOTIFIKASI
// ==========================================
router.get('/notifikasi',            senaraiNotifikasi);
router.put('/notifikasi/baca-semua', tandaBacaNotifikasi);
router.get('/notifikasi/bilangan',   bilanganNotifikasiBelumBaca);

export default router;