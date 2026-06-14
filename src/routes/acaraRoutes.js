import express from 'express';
import {
    // Ahli
    senaraiAcaraAktif,
    sertaiAcara,
    batalSertai,
    // Admin
    ciptaAcara,
    senaraiSemuaAcara,
    kemaskiniAcara,
    senaraiPesertaAcara,
    padamAcara,
    padamPesertaAcara,
    kemaskiniPergerakanPeserta,
    analisisAcara,
    kemaskiniJersi,
    tambahPesertaAdmin,
    cariAhliUntukAcara
} from '../controllers/acaraController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Semua laluan memerlukan log masuk
router.use(verifyToken);

// ------------------------------------------
// LALUAN AHLI
// ------------------------------------------
router.get('/aktif', senaraiAcaraAktif);            // senarai acara aktif
router.post('/daftar', sertaiAcara);                // daftar acara
router.delete('/batal/:acara_id', batalSertai);     // batal pendaftaran

// ------------------------------------------
// LALUAN ADMIN (Admin / Super Admin / Bendahari)
// ------------------------------------------
const adminOnly = requireRole(['Admin', 'Super Admin', 'Bendahari']);

router.post('/admin/cipta',          adminOnly, upload.array('poster', 5), ciptaAcara);
router.get('/admin/semua',           adminOnly, senaraiSemuaAcara);
router.put('/admin/kemaskini/:id',   adminOnly, upload.array('poster', 5), kemaskiniAcara);
router.get('/admin/peserta/:id',     adminOnly, senaraiPesertaAcara);
router.delete('/admin/padam/:id',    adminOnly, padamAcara);
router.get('/admin/analisis/:id',    adminOnly, analisisAcara);
router.put('/admin/jersi',           adminOnly, kemaskiniJersi);
router.post('/admin/tambah-peserta',    adminOnly, tambahPesertaAdmin);
router.delete('/admin/padam-peserta/:id',      adminOnly, padamPesertaAcara);
router.put('/admin/pergerakan-peserta/:id',   adminOnly, kemaskiniPergerakanPeserta);
router.get('/admin/cari-ahli',               adminOnly, cariAhliUntukAcara);

export default router;