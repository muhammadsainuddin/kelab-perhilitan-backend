import express from 'express';
import {
    senaraiKebajikan,
    kemaskiniStatusKebajikan,
    senaraiBerhentiAhli,
    kemaskiniBerhentiAhli,
    senaraiSemuaAhli,
    kemaskiniAhli,
    kemaskiniProfilAhli,
    getBelumDaftar,
    daftarAhliManual,
    janaNoAhliBiroPukal,
    janaSemulaNoBiroPukal,
    senaraiSemuaStaff,
    tambahStaffBulk,
    getProfilSaya,
    kemaskiniProfilSaya,
    tukarKatalaluan,
    getStatistikTunggakan,
    getAllResitBayaran,
    getDirektoriBersepadu,
    getAcaraAhli,
    getProfilAhliLengkap,
    senaraiPenempatan,
    tambahPenempatan,
    kemaskiniPenempatan,
    hapusPenempatan
} from '../controllers/adminController.js';

import {
    cariAhliPenerima,
    ciptaKempen,
    senaraiKempenAdmin,
    kemaskiniKempen,
    senaraiRekodKempen,
    senaraiGambarKempen,
    tambahGambarKempen,
    hapusGambarKempen
} from '../controllers/sumbanganController.js';

import {
    janaResitBiroAngkasa,
    senaraiResitBiroAdmin,
    statistikResitBiro,
    detailResitBiro
} from '../controllers/resitController.js';

import { verifyToken, requireRole } from '../middleware/authMiddleware.js';
import { upload, uploadGambar, mampatGambar } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Wajib log masuk DAN mempunyai peranan pentadbiran
router.use(verifyToken, requireRole(['Admin', 'Super Admin', 'Bendahari']));

// ------------------------------------------
// PROFIL & KESELAMATAN ADMIN
// ------------------------------------------
router.get('/profil-saya', getProfilSaya);
router.put('/profil-saya', kemaskiniProfilSaya);
router.put('/tukar-katalaluan', tukarKatalaluan);

// ------------------------------------------
// PENGURUSAN AHLI
// ------------------------------------------
router.get('/semua-ahli', senaraiSemuaAhli);
router.get('/belum-daftar', getBelumDaftar);
router.put('/kemaskini-ahli/:no_kp', kemaskiniAhli);
router.put('/kemaskini-profil-ahli/:no_kp', kemaskiniProfilAhli);
router.post('/daftar-ahli', daftarAhliManual);
router.post('/jana-no-ahli-biro', janaNoAhliBiroPukal);
router.post('/jana-semula-no-ahli-biro', janaSemulaNoBiroPukal);

// ------------------------------------------
// PENGURUSAN INDUK PENGGUNA (IMPORT CSV)
// ------------------------------------------
router.get('/semua-staff', senaraiSemuaStaff);
router.post('/tambah-staff-pukal', tambahStaffBulk);

// ------------------------------------------
// RESIT PEMBAYARAN
// ------------------------------------------
router.get('/sejarah-bayaran', getAllResitBayaran);

// Resit Biro Angkasa (berasingan dari FPX)
router.post('/resit-biro-angkasa/jana',       janaResitBiroAngkasa);
router.get('/resit-biro-angkasa',             senaraiResitBiroAdmin);
router.get('/resit-biro-angkasa/statistik',   statistikResitBiro);
router.get('/resit-biro-angkasa/:no_resit',   detailResitBiro);

// ------------------------------------------
// KEBAJIKAN & BERHENTI
// ------------------------------------------
router.get('/kebajikan', senaraiKebajikan);
router.put('/kebajikan/:id', kemaskiniStatusKebajikan);
router.get('/berhenti', senaraiBerhentiAhli);
router.put('/berhenti/:id', kemaskiniBerhentiAhli);

// ------------------------------------------
// STATISTIK & DIREKTORI
// ------------------------------------------
router.get('/statistik-tunggakan', getStatistikTunggakan);
router.get('/direktori-bersepadu', getDirektoriBersepadu);

router.get('/acara-ahli/:no_kp', verifyToken, requireRole(['Admin', 'Super Admin']), getAcaraAhli);

// ------------------------------------------
// KEMPEN SUMBANGAN
// ------------------------------------------
router.get('/sumbangan/cari-ahli',        cariAhliPenerima);
router.get('/sumbangan/kempen',           senaraiKempenAdmin);
router.post('/sumbangan/kempen',          upload.single('qr_code'), ciptaKempen);
router.put('/sumbangan/kempen/:id',       upload.single('qr_code'), kemaskiniKempen);
router.get('/sumbangan/kempen/:id/rekod',           senaraiRekodKempen);
router.get('/sumbangan/kempen/:id/gambar',          senaraiGambarKempen);
router.post('/sumbangan/kempen/:id/gambar',         uploadGambar('gambar', 10), mampatGambar, tambahGambarKempen);
router.delete('/sumbangan/kempen/:id/gambar/:gid',  hapusGambarKempen);



router.get('/profil-ahli/:no_kp', verifyToken, requireRole(['Admin', 'Super Admin']), getProfilAhliLengkap);

// ------------------------------------------
// PENGURUSAN PENEMPATAN (PTJ)
// ------------------------------------------
router.get('/penempatan',         senaraiPenempatan);
router.post('/penempatan',        tambahPenempatan);
router.put('/penempatan/:id',     kemaskiniPenempatan);
router.delete('/penempatan/:id',  hapusPenempatan);

export default router;