import express from 'express';
import { ambilTetapan, kemaskiniTetapan, ambilTetapanTeks, kemaskiniTetapanTeks } from '../controllers/settingsController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.get('/', ambilTetapan);
// Specific routes dahulu (sebelum /:kunci yang general)
router.get('/teks/:kunci', requireRole(['Admin', 'Super Admin']), ambilTetapanTeks);
router.put('/teks/:kunci', requireRole(['Admin', 'Super Admin']), kemaskiniTetapanTeks);
router.put('/:kunci',      requireRole(['Admin', 'Super Admin']), kemaskiniTetapan);

export default router;
