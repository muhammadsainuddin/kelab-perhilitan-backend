import express from 'express';
import { register, login, forgotPassword, resetPassword, renewToken, requestDeletion, daftarBaru, senaraiPenempatanAwam, senaraiGredAwam } from '../controllers/authController.js';

const router = express.Router();

router.get('/penempatan', senaraiPenempatanAwam);
router.get('/senarai-gred', senaraiGredAwam);
router.post('/daftar-baru', daftarBaru);
router.post('/register', register);
router.post('/login', login);
router.post('/renew', renewToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.post('/request-deletion', requestDeletion);

export default router;