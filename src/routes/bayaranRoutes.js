import express from 'express';
import { ciptaBil, toyyibpayCallback, getSejarahYuran, getSejarahSemua, semakStatusBayaran } from '../controllers/bayaranController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/callback', toyyibpayCallback);
router.post('/cipta-bil', verifyToken, ciptaBil);

// Laluan diasingkan:
router.get('/sejarah-yuran', verifyToken, getSejarahYuran); // Untuk Tab Yuran Sahaja
router.get('/sejarah-semua', verifyToken, getSejarahSemua); // Untuk Paparan Gabungan Transaksi

router.get('/semak-status/:billcode', verifyToken, semakStatusBayaran);

export default router;