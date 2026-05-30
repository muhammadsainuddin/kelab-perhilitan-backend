import express from 'express';
import { checkStatus, mohonBantuan, mohonBerhenti } from '../controllers/memberController.js';
import { verifyToken } from '../middleware/authMiddleware.js'; // Pastikan hanya yang log masuk boleh akses
import { upload } from '../middleware/uploadMiddleware.js'; // Jika nak upload dokumen sokongan

const router = express.Router();

// Semua route di bawah mesti lalui verifyToken (mesti log masuk)
router.use(verifyToken);

router.get('/status', checkStatus);
router.post('/kebajikan', upload.single('dokumen'), mohonBantuan); // 'dokumen' adalah nama input file
router.post('/berhenti', mohonBerhenti);

export default router;