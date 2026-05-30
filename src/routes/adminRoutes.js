import express from 'express';
import { 
    senaraiKebajikan, 
    kemaskiniStatusKebajikan, 
    senaraiBerhentiAhli, 
    kemaskiniBerhentiAhli,
    senaraiMenungguSahkan,
    sahkanAkaun,
    senaraiSemuaAhli,
    kemaskiniAhli,
    daftarAhliManual, // <--- FUNGSI BARU
    senaraiSemuaStaff,
    tambahStaffBulk,
    getProfilSaya,
    kemaskiniProfilSaya,
    tukarKatalaluan,  // <--- FUNGSI BARU
    getStatistikTunggakan,
    getAllResitBayaran,
    getDirektoriBersepadu
} from '../controllers/adminController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// Wajib log masuk DAN mempunyai peranan 'Admin'
router.use(verifyToken, requireRole(['Admin', 'Super Admin']));

// ------------------------------------------
// PENGURUSAN PROFIL & KESELAMATAN ADMIN
// ------------------------------------------
router.get('/profil-saya', getProfilSaya);
router.put('/profil-saya', kemaskiniProfilSaya);
router.put('/tukar-katalaluan', tukarKatalaluan);

// ------------------------------------------
// PENGURUSAN AHLI & PENDAFTARAN
// ------------------------------------------
router.get('/semua-ahli', senaraiSemuaAhli);
router.put('/kemaskini-ahli/:no_kp', kemaskiniAhli);
router.post('/daftar-ahli', daftarAhliManual);

router.get('/pengesahan', senaraiMenungguSahkan);
router.put('/pengesahan/:no_kp', sahkanAkaun);

// ------------------------------------------
// PENGURUSAN INDUK STAFF
// ------------------------------------------
router.get('/semua-staff', senaraiSemuaStaff);
router.post('/tambah-staff-pukal', tambahStaffBulk);

// ------------------------------------------
// PENGURUSAN RESIT PEMBAYARAN
// ------------------------------------------
router.get('/sejarah-bayaran', getAllResitBayaran);

// ------------------------------------------
// PENGURUSAN KEBAJIKAN & BERHENTI
// ------------------------------------------
router.get('/kebajikan', senaraiKebajikan);
router.put('/kebajikan/:id', kemaskiniStatusKebajikan);

router.get('/berhenti', senaraiBerhentiAhli);
router.put('/berhenti/:id/lulus', kemaskiniBerhentiAhli);

router.get('/statistik-tunggakan', getStatistikTunggakan);

router.get('/direktori-bersepadu', getDirektoriBersepadu);

export default router;