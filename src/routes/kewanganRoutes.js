// ============================================================
// FAIL: src/routes/kewanganRoutes.js
// ============================================================
import expressK from 'express';
import {
    getStatistikKewangan, getSenaraiTransaksi, rekodKeluar, eksportCSV,
    getPenyataTahunan, getSenaraiSumbangan, rekodSumbangan, importSumbanganBulk,
    getProdukLaris, getLaporanBulanan, getLaporanHarian, rekodTransaksi,
} from '../controllers/kewanganController.js';
import { verifyToken as vT, requireRole as rR } from '../middleware/authMiddleware.js';

const routerK = expressK.Router();
// Bendahari turut mengurus kewangan kelab (rekod perbelanjaan, sumbangan, penyata)
routerK.use(vT, rR(['Admin','Super Admin','Bendahari']));

routerK.get('/statistik',         getStatistikKewangan);
routerK.get('/transaksi',         getSenaraiTransaksi);
routerK.post('/keluar',           rekodKeluar);
routerK.get('/eksport',           eksportCSV);

// Penyata kewangan tahunan
routerK.get('/penyata-tahunan',   getPenyataTahunan);

// Kutipan sumbangan
routerK.get('/sumbangan',         getSenaraiSumbangan);
routerK.post('/sumbangan',        rekodSumbangan);
routerK.post('/sumbangan/import', importSumbanganBulk);

// Rekod tunggal (masuk/keluar), laporan berkala, produk laris
routerK.post('/rekod',            rekodTransaksi);
routerK.get('/produk-laris',      getProdukLaris);
routerK.get('/laporan-bulanan',   getLaporanBulanan);
routerK.get('/laporan-harian',    getLaporanHarian);

export default routerK;
