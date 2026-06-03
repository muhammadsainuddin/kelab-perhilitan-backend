import express from 'express';
import { mohonBantuan, sejarahBantuan, ambilKadar, kemaskiniKadar } from '../controllers/bantuanController.js';
import { upload } from '../middleware/uploadMiddleware.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/mohon',  verifyToken, upload.array('dokumen', 20), mohonBantuan);
router.get('/sejarah', verifyToken, sejarahBantuan);

// Kadar bantuan — semua yang login boleh baca, hanya YDP boleh ubah
router.get('/kadar',        verifyToken, ambilKadar);
router.put('/kadar/:kunci', verifyToken, kemaskiniKadar);

export default router;