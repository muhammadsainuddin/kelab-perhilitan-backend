import express from 'express';
import { register, login, forgotPassword, resetPassword, renewToken, requestDeletion } from '../controllers/authController.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/renew', renewToken);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.post('/request-deletion', requestDeletion);

export default router;