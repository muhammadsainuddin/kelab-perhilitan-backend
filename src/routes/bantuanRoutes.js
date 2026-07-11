import express from 'express';
import { mohonBantuan, sejarahBantuan, ambilKadar, kemaskiniKadar, mohonBantuanBagiPihak } from '../controllers/bantuanController.js';
import { uploadBantuan } from '../middleware/uploadMiddleware.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/mohon',  verifyToken, uploadBantuan.array('dokumen', 20), mohonBantuan);
router.get('/sejarah', verifyToken, sejarahBantuan);

// Kadar bantuan — semua yang login boleh baca, hanya YDP boleh ubah
router.get('/kadar',        verifyToken, ambilKadar);
router.put('/kadar/:kunci', verifyToken, kemaskiniKadar);

// Admin mohon bantuan bagi pihak waris (ahli meninggal dunia)
router.post('/mohon-bagi-pihak', verifyToken, requireRole(['Admin', 'Super Admin']), uploadBantuan.array('dokumen', 20), mohonBantuanBagiPihak);

export default router;