import express from 'express';
import { ambilTetapan, kemaskiniTetapan } from '../controllers/settingsController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.get('/', ambilTetapan);
router.put('/:kunci', requireRole(['Admin', 'Super Admin']), kemaskiniTetapan);

export default router;
