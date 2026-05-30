// Contoh di fail laluan (routes) anda
import express from 'express';
import { mohonBantuan, sejarahBantuan } from '../controllers/bantuanController.js';
import { upload } from '../middleware/uploadMiddleware.js'; // middleware multer anda
import { verifyToken } from '../middleware/authMiddleware.js'; 

const router = express.Router();

// TUKAR DI SINI: Gunakan upload.array('dokumen', 20)
router.post('/mohon', verifyToken, upload.array('dokumen', 20), mohonBantuan);

router.get('/sejarah', verifyToken, sejarahBantuan);

export default router;