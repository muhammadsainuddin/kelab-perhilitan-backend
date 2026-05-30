import express from 'express';
// 1. Tambah 'register' di dalam senarai import ini
import { register, login, forgotPassword, resetPassword } from '../controllers/authController.js';

const router = express.Router();

// 2. Tambah laluan (route) untuk pendaftaran di sini
router.post('/register', register);

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

export default router;