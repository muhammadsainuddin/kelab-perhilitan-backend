import express from 'express';
import {
    senaraiProduk, tambahProduk, kemaskiniProduk, padamProduk,
    senaraiProdukAktif, senaraiPesanan, kemaskiniStatusPesanan,
    buatPesanan, webhookKedai, semakPesanan, senaraiPesananAhli
} from '../controllers/kedaiController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';
import { uploadGambar, mampatGambar } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// ── Webhook (TANPA auth — callback ToyyibPay) ──
router.post('/webhook/:pesananId', webhookKedai);

// ── Ahli (perlu login) ──
router.use(verifyToken);
router.get('/produk-aktif',     senaraiProdukAktif);   // paparan kedai ahli
router.post('/beli',            buatPesanan);
router.get('/semak/:pesananId', semakPesanan);
router.get('/pesanan-saya', verifyToken, senaraiPesananAhli);

// ── Admin sahaja (upload.array untuk pelbagai gambar - max 6) ──
router.get('/admin/produk',             requireRole(['Admin','Super Admin']), senaraiProduk);
router.post('/admin/produk',            requireRole(['Admin','Super Admin']), uploadGambar('gambar', 6), mampatGambar, tambahProduk);
router.put('/admin/produk/:id',         requireRole(['Admin','Super Admin']), uploadGambar('gambar', 6), mampatGambar, kemaskiniProduk);
router.delete('/admin/produk/:id',      requireRole(['Admin','Super Admin']), padamProduk);
router.get('/admin/pesanan',            requireRole(['Admin','Super Admin']), senaraiPesanan);
router.put('/admin/pesanan/:id/status', requireRole(['Admin','Super Admin']), kemaskiniStatusPesanan);

export default router;