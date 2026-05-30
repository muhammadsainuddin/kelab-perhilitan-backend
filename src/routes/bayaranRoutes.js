import express from 'express';
import { ciptaBil, toyyibpayCallback, getSejarahBayaran, semakStatusBayaran } from '../controllers/bayaranController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/callback', toyyibpayCallback);
router.post('/cipta-bil', verifyToken, ciptaBil);
router.get('/sejarah', verifyToken, getSejarahBayaran);

// LALUAN BARU UNTUK SEMAKAN
router.get('/semak-status/:billcode', verifyToken, semakStatusBayaran);

export default router;