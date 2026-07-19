// ============================================================
// FAIL: src/routes/kewanganRoutes.js
// ============================================================
import expressK from 'express';
import {
    getStatistikKewangan, getSenaraiTransaksi, rekodKeluar, eksportCSV,
    getPenyataTahunan, getSenaraiSumbangan, rekodSumbangan, importSumbanganBulk,
    kemaskiniSumbangan, padamSumbangan, rekodTuntutanMakswip,
    getProdukLaris, getLaporanBulanan, getLaporanHarian, getLaporanKategori, rekodTransaksi,
    kemaskiniTransaksi, padamTransaksi, getLogEditTransaksi,
    getAcaraKhas, tambahAcaraKhas, kemaskiniAcaraKhas, getPenyataAcaraKhas,
    getPakejSumbangan, tambahPakej, kemaskiniPakej, getSenaraiStaff,
    getKategoriKewangan, tambahKategoriKewangan, kemaskiniKategoriKewangan,
    padamKategoriKewangan, getLaporanPerbelanjaanAcara,
} from '../controllers/kewanganController.js';
import { verifyToken as vT, requireRole as rR } from '../middleware/authMiddleware.js';
import { uploadTuntutan, uploadKewangan, mampatGambar } from '../middleware/uploadMiddleware.js';

const routerK = expressK.Router();
// Bendahari turut mengurus kewangan kelab (rekod perbelanjaan, sumbangan, penyata)
routerK.use(vT, rR(['Admin','Super Admin','Bendahari']));

routerK.get('/statistik',         getStatistikKewangan);
routerK.get('/transaksi',         getSenaraiTransaksi);
routerK.post('/keluar',           rekodKeluar);
routerK.get('/eksport',           eksportCSV);

// Penyata kewangan tahunan
routerK.get('/penyata-tahunan',   getPenyataTahunan);

// Kutipan sumbangan luar (melalui MAKSWIP)
routerK.get('/sumbangan',              getSenaraiSumbangan);
routerK.post('/sumbangan',             rekodSumbangan);
routerK.post('/sumbangan/import',      importSumbanganBulk);
routerK.put('/sumbangan/:id',          kemaskiniSumbangan);
routerK.delete('/sumbangan/:id',       padamSumbangan);
routerK.post('/tuntutan-makswip',      uploadTuntutan.single('fail_dokumen'), rekodTuntutanMakswip);

// Rekod tunggal (masuk/keluar), laporan berkala, produk laris
routerK.post('/rekod',            uploadKewangan.array('dokumen', 5), mampatGambar, rekodTransaksi);
routerK.put('/transaksi/:id',      uploadKewangan.array('dokumen', 5), mampatGambar, kemaskiniTransaksi);
routerK.delete('/transaksi/:id',   padamTransaksi);
routerK.get('/transaksi/:id/log',  getLogEditTransaksi);
routerK.get('/produk-laris',      getProdukLaris);
routerK.get('/laporan-bulanan',   getLaporanBulanan);
routerK.get('/laporan-harian',    getLaporanHarian);
routerK.get('/laporan-kategori',  getLaporanKategori);

// Acara Khas (Sakom, dll.)
routerK.get('/acara-khas',                    getAcaraKhas);
routerK.post('/acara-khas',                   tambahAcaraKhas);
routerK.put('/acara-khas/:id',                kemaskiniAcaraKhas);
routerK.get('/acara-khas/:id/penyata',        getPenyataAcaraKhas);
routerK.get('/acara-khas/:id/pakej',          getPakejSumbangan);
routerK.post('/acara-khas/:id/pakej',         tambahPakej);
routerK.put('/pakej/:id',                     kemaskiniPakej);

// Staff untuk dropdown PIC
routerK.get('/staff',                         getSenaraiStaff);

// Kategori perbelanjaan/pendapatan (custom + sistem)
routerK.get('/kategori',                      getKategoriKewangan);
routerK.post('/kategori',                     tambahKategoriKewangan);
routerK.put('/kategori/:id',                  kemaskiniKategoriKewangan);
routerK.delete('/kategori/:id',               padamKategoriKewangan);

// Laporan perbelanjaan per acara khas
routerK.get('/acara-khas/:id/laporan-perbelanjaan', getLaporanPerbelanjaanAcara);

export default routerK;
