import express from 'express';
import {
    senaraiProduk, tambahProduk, kemaskiniProduk, padamProduk,
    senaraiProdukAktif, senaraiPesanan, kemaskiniStatusPesanan,
    buatPesanan, webhookKedai, semakPesanan, senaraiPesananAhli,
    daftarPenjual, senaraiPenjual, kemaskiniStatusPenjual, semakStatusPenjual,
} from '../controllers/kedaiController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';
import { uploadGambar, mampatGambar } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// ── Webhook (TANPA auth — callback ToyyibPay) ──
router.post('/webhook/:pesananId', webhookKedai);

// ── Ahli (perlu login) ──
router.use(verifyToken);
router.get('/produk-aktif',        senaraiProdukAktif);
router.post('/beli',               buatPesanan);
router.get('/semak/:pesananId',    semakPesanan);
router.get('/pesanan-saya',        senaraiPesananAhli);
router.post('/daftar-jual',        daftarPenjual);
router.get('/status-penjual',      semakStatusPenjual);

// ── Admin sahaja ──
router.get('/admin/produk',             requireRole(['Admin','Super Admin']), senaraiProduk);
router.post('/admin/produk',            requireRole(['Admin','Super Admin']), uploadGambar('gambar', 6), mampatGambar, tambahProduk);
router.put('/admin/produk/:id',         requireRole(['Admin','Super Admin']), uploadGambar('gambar', 6), mampatGambar, kemaskiniProduk);
router.delete('/admin/produk/:id',      requireRole(['Admin','Super Admin']), padamProduk);
router.get('/admin/pesanan',            requireRole(['Admin','Super Admin']), senaraiPesanan);
router.put('/admin/pesanan/:id/status', requireRole(['Admin','Super Admin']), kemaskiniStatusPesanan);
router.get('/admin/penjual',            requireRole(['Admin','Super Admin']), senaraiPenjual);
router.put('/admin/penjual/:id',        requireRole(['Admin','Super Admin']), kemaskiniStatusPenjual);

export default router;
