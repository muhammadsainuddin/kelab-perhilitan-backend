// ============================================================
// FAIL: src/routes/kewanganRoutes.js
// ============================================================
import expressK from 'express';
import {
    getStatistikKewangan, getSenaraiTransaksi, rekodKeluar, eksportCSV,
} from '../controllers/kewanganController.js';
import { verifyToken as vT, requireRole as rR } from '../middleware/authMiddleware.js';

const routerK = expressK.Router();
routerK.use(vT, rR(['Admin','Super Admin']));

routerK.get('/statistik',  getStatistikKewangan);
routerK.get('/transaksi',  getSenaraiTransaksi);
routerK.post('/keluar',    rekodKeluar);
routerK.get('/eksport',    eksportCSV);

export default routerK;
