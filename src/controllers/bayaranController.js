import db from '../config/db.js';
import axios from 'axios';
import { janaNoAhliBaru } from '../utils/keahlianHelper.js';
import { janaBilFPX } from '../utils/toyyibpay.js'; 

// ==========================================
// 1. CIPTA BIL YURAN
// ==========================================
export const ciptaBil = async (req, res) => {
    const no_kp = req.user.no_kp;
    const user_id = req.user.id;

    let { keterangan, amaun, jenis_bayaran } = req.body; 

    try {
        // --- SEMAKAN TRANSAKSI PENDING (Tanpa Auto-Cancel) ---
        const [pendingBills] = await db.query(`
            SELECT billCode, TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) as minit_berlalu 
            FROM sejarah_bayaran 
            WHERE no_kp = ? AND status = 'PENDING' 
            ORDER BY tarikh_cipta DESC LIMIT 1
        `, [no_kp]);

        if (pendingBills.length > 0) {
            const pending = pendingBills[0];
            if (pending.minit_berlalu < 15) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Anda mempunyai transaksi yang sedang diproses di bank. Sila tunggu sebentar atau semak sejarah transaksi anda.` 
                });
            }
        }

        const [users] = await db.query(`SELECT nama_pegawai, emel, phone, gred_penyandang_sspa, yuran_kelab_bulanan FROM users WHERE no_kp = ?`, [no_kp]);
        if (users.length === 0) return res.status(404).json({ success: false, message: "Data kakitangan tidak dijumpai." });
        const user = users[0];

        let finalAmaun = parseFloat(amaun);

        if (jenis_bayaran === 'YURAN') {
            let yuranBulanan = parseFloat(user.yuran_kelab_bulanan || 0);
            if (yuranBulanan <= 0) {
                const gred = (user.gred_penyandang_sspa || '').toUpperCase();
                if (gred.includes('JUSA') || gred.includes('VU') || gred.includes('VK') || gred.includes('UTAMA')) yuranBulanan = 15.00;
                else {
                    const match = gred.match(/\d+/);
                    if (match) {
                        const num = parseInt(match[0], 10);
                        yuranBulanan = (num >= 9 && num <= 14) ? 10.00 : 5.00;
                    } else yuranBulanan = 5.00;
                }
            }
            finalAmaun = yuranBulanan * 12; 
            keterangan = `Yuran Tahunan Kelab Sesi ${new Date().getFullYear()}`;
        }

        if (finalAmaun <= 0) return res.status(400).json({ success: false, message: "Ralat: Jumlah bayaran tidak sah (RM0.00)." });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const backendUrl  = process.env.BACKEND_URL  || 'http://localhost:5001';
        
        const fpxData = await janaBilFPX({
            keterangan: keterangan,
            amaun: finalAmaun,
            returnUrl: `${frontendUrl}/dashboard/yuran`,
            callbackUrl: `${backendUrl}/api/bayaran/callback`,
            referenceNo: `INV-${no_kp}-${Date.now()}`,
            user: user,
            jenis: 'YURAN'
        });

        // Rekod ke DB
        await db.query(
            'INSERT INTO sejarah_bayaran (no_kp, user_id, billCode, amaun, status, keterangan, tarikh_cipta) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [no_kp, user_id, fpxData.billCode, finalAmaun, 'PENDING', keterangan]
        );

        res.status(200).json({ success: true, bill_url: fpxData.billUrl });

    } catch (error) {
        console.error("🔴 [FPX ERROR]:", error.message);
        res.status(500).json({ success: false, message: "Gagal memproses pembayaran. Sila cuba lagi sebentar." });
    }
};

// ==========================================
// 2. PROSES BAYARAN BERJAYA (YURAN)
// ==========================================
const prosesBayaranBerjaya = async (billcode) => {
    // KITA AMBIL AMAUN & KETERANGAN UNTUK DIREKODKAN KE DALAM BUKU TUNAI
    const [bayaran] = await db.query('SELECT no_kp, status, amaun, keterangan FROM sejarah_bayaran WHERE billCode = ?', [billcode]);
    if (bayaran.length === 0 || bayaran[0].status === 'BERJAYA') return;

    const { no_kp, amaun, keterangan } = bayaran[0];
    const [ahli] = await db.query('SELECT no_ahli FROM users WHERE no_kp = ?', [no_kp]);

    // 1. Beri nombor ahli secara automatik untuk ahli manual yang berjaya bayar
    if (ahli.length > 0) {
        const noAhliSedia = ahli[0].no_ahli;
        if (!noAhliSedia || String(noAhliSedia).trim() === '') {
            const noAhliBaru = await janaNoAhliBaru();
            await db.query('UPDATE users SET no_ahli = ? WHERE no_kp = ?', [noAhliBaru, no_kp]);
        }
    }
    
    // 2. Kemaskini status yuran kepada BERJAYA
    await db.query('UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', [billcode]);

    // 3. REKODKAN MASUK KE DALAM BUKU TUNAI (TRANSAKSI KEWANGAN)
    try {
        await db.query(`
            INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak)
            VALUES ('MASUK', 'YURAN', ?, ?, ?, ?)
        `, [amaun, billcode, keterangan || 'Bayaran Yuran Kelab Tahunan', no_kp]);
    } catch (e) {
        console.error('[YURAN] Gagal rekod transaksi kewangan:', e.message);
    }
};

// ==========================================
// 3. WEBHOOK CALLBACK (DIPANGGIL OLEH BANK)
// ==========================================
export const toyyibpayCallback = async (req, res) => {
    const { status_id, billcode } = req.body;
    try {
        if (status_id == 1) await prosesBayaranBerjaya(billcode);
        else await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
        return res.status(200).send('OK');
    } catch (error) { return res.status(500).send('Ralat Pelayan Webhook'); }
};

// ==========================================
// 4A. SEJARAH YURAN SAHAJA (Untuk Tab Yuran Ahli)
// ==========================================
export const getSejarahYuran = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [pendingYuran] = await db.query(`SELECT billCode FROM sejarah_bayaran WHERE no_kp = ? AND status = 'PENDING'`, [no_kp]);
        const toyyibpayUrl = process.env.TOYYIBPAY_URL ? process.env.TOYYIBPAY_URL.replace('createBill', 'getBillTransactions') : 'https://dev.toyyibpay.com/index.php/api/getBillTransactions';

        // Auto-Sync Yuran
        for (const item of pendingYuran) {
            try {
                const formData = new URLSearchParams({ billCode: item.billCode });
                const txRes = await axios.post(toyyibpayUrl, formData.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                if (txRes.data && txRes.data.length > 0) {
                    if (txRes.data.find(tx => tx.billpaymentStatus == '1')) await prosesBayaranBerjaya(item.billCode);
                    else if (txRes.data.find(tx => tx.billpaymentStatus == '3')) await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [item.billCode]);
                }
            } catch(e) {}
        }

        const [rows] = await db.query(`
            SELECT billCode, amaun, status, keterangan, DATE_FORMAT(tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh
            FROM sejarah_bayaran WHERE no_kp = ? ORDER BY tarikh_cipta DESC
        `, [no_kp]);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik sejarah yuran." });
    }
};

// ==========================================
// 4B. SEJARAH KESELURUHAN & GABUNGAN (Yuran + Kedai)
// ==========================================
export const getSejarahSemua = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const toyyibpayUrl = process.env.TOYYIBPAY_URL ? process.env.TOYYIBPAY_URL.replace('createBill', 'getBillTransactions') : 'https://dev.toyyibpay.com/index.php/api/getBillTransactions';

        // Auto-Sync Kedai
        const [pendingKedai] = await db.query(`SELECT id, billCode FROM pesanan_kedai WHERE no_kp = ? AND status_pesanan = 'PENDING' AND billCode IS NOT NULL`, [no_kp]);
        for (const item of pendingKedai) {
            try {
                const formData = new URLSearchParams({ billCode: item.billCode });
                const txRes = await axios.post(toyyibpayUrl, formData.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                if (txRes.data && txRes.data.length > 0) {
                    if (txRes.data.find(tx => tx.billpaymentStatus == '1')) {
                        const conn = await db.getConnection();
                        try {
                            await conn.beginTransaction();
                            await conn.query('UPDATE pesanan_kedai SET status_pesanan = "DIBAYAR" WHERE id = ?', [item.id]);
                            const [items] = await conn.query('SELECT produk_id, kuantiti, saiz FROM item_pesanan WHERE pesanan_id = ?', [item.id]);
                            for (const it of items) {
                                const [[prod]] = await conn.query('SELECT id, is_variasi, variasi_data, stok_semasa FROM produk_kedai WHERE id = ? FOR UPDATE', [it.produk_id]);
                                if (prod) {
                                    if (prod.is_variasi) {
                                        let vData = JSON.parse(prod.variasi_data || '[]');
                                        let allZero = true;
                                        vData = vData.map(v => {
                                            if (v.nama === it.saiz) v.stok = Math.max(0, parseInt(v.stok) - it.kuantiti);
                                            if (parseInt(v.stok) > 0) allZero = false;
                                            return v;
                                        });
                                        await conn.query('UPDATE produk_kedai SET variasi_data = ?, status = ? WHERE id = ?', [JSON.stringify(vData), allZero ? 'HABIS' : 'AKTIF', prod.id]);
                                    } else {
                                        await conn.query('UPDATE produk_kedai SET stok_semasa = GREATEST(0, stok_semasa - ?) WHERE id = ?', [it.kuantiti, prod.id]);
                                        await conn.query('UPDATE produk_kedai SET status = "HABIS" WHERE id = ? AND stok_semasa = 0', [prod.id]);
                                    }
                                }
                            }
                            try {
                                await conn.query(`INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak) SELECT 'MASUK','KEDAI',jumlah_keseluruhan,billCode,CONCAT('Jualan Kedai — Pesanan #',id),no_kp FROM pesanan_kedai WHERE id = ?`, [item.id]);
                            } catch(e) {}
                            await conn.commit();
                        } catch (e) { await conn.rollback(); } finally { conn.release(); }
                    } else if (txRes.data.find(tx => tx.billpaymentStatus == '3')) {
                        await db.query('UPDATE pesanan_kedai SET status_pesanan = "DIBATALKAN" WHERE id = ?', [item.id]);
                    }
                }
            } catch(e) {}
        }

        // UNION QUERY UNTUK GABUNG KEDUA-DUA REKOD
        const query = `
            SELECT billCode, amaun, status, keterangan, tarikh_cipta
            FROM (
                SELECT billCode, amaun, status, keterangan, tarikh_cipta
                FROM sejarah_bayaran WHERE no_kp = ?
                UNION ALL
                SELECT billCode, jumlah_keseluruhan AS amaun, 
                    CASE WHEN status_pesanan IN ('DIBAYAR','DIPROSES','SELESAI') THEN 'BERJAYA'
                         WHEN status_pesanan = 'DIBATALKAN' THEN 'GAGAL'
                         ELSE status_pesanan END AS status, 
                    CONCAT('Pembelian Kedai: Pesanan #', id) AS keterangan, tarikh_pesanan AS tarikh_cipta
                FROM pesanan_kedai WHERE no_kp = ? AND billCode IS NOT NULL
            ) AS gabungan
            ORDER BY tarikh_cipta DESC
        `;
        const [rows] = await db.query(query, [no_kp, no_kp]);
        const formattedRows = rows.map(r => {
            const dt = new Date(r.tarikh_cipta);
            return { ...r, tarikh: `${dt.toLocaleDateString('ms-MY', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${dt.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: true })}` };
        });
        res.status(200).json({ success: true, data: formattedRows });
    } catch (error) { res.status(500).json({ success: false, message: "Gagal menarik sejarah keseluruhan." }); }
};

// ==========================================
// 5. SEMAKAN MANUAL API (Auto-Polling)
// ==========================================
export const semakStatusBayaran = async (req, res) => {
    const { billcode } = req.params;
    try {
        const formData = new URLSearchParams({ billCode: billcode });
        const toyyibpayUrl = process.env.TOYYIBPAY_URL ? process.env.TOYYIBPAY_URL.replace('createBill', 'getBillTransactions') : 'https://dev.toyyibpay.com/index.php/api/getBillTransactions';
        const toyyibRes = await axios.post(toyyibpayUrl, formData.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        if (!toyyibRes.data || toyyibRes.data.length === 0) return res.status(200).json({ success: true, status: 'PENDING' });
        const successfulTx = toyyibRes.data.find(tx => tx.billpaymentStatus == '1');
        
        if (successfulTx) {
            await prosesBayaranBerjaya(billcode);
            return res.status(200).json({ success: true, status: 'BERJAYA' });
        } else {
            if (toyyibRes.data.find(tx => tx.billpaymentStatus == '3')) {
                await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
                return res.status(200).json({ success: true, status: 'GAGAL' });
            }
            return res.status(200).json({ success: true, status: 'PENDING' });
        }
    } catch (error) { return res.status(500).json({ success: false, status: 'PENDING' }); }
};