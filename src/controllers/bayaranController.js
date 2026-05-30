import db from '../config/db.js';
import { janaBilFPX, semakTransaksiBil } from '../utils/toyyibpay.js';
import { prosesYuranBerjaya } from '../utils/paymentSync.js';

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
// 3. WEBHOOK CALLBACK (DIPANGGIL OLEH BANK)
//    (Logik proses yuran kini di utils/paymentSync.js)
// ==========================================
export const toyyibpayCallback = async (req, res) => {
    const { billcode } = req.body;
    if (!billcode) return res.status(400).send('Bad Request');

    try {
        // PENTING: Jangan percaya status_id dari body callback (boleh dipalsukan).
        // Sahkan status sebenar terus dengan pelayan ToyyibPay.
        const status = await semakTransaksiBil(billcode);

        if (status === 'BERJAYA') {
            await prosesYuranBerjaya(billcode);
        } else if (status === 'GAGAL') {
            await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
        }
        // status PENDING: biarkan rekod kekal PENDING, jangan ubah apa-apa.

        return res.status(200).send('OK');
    } catch (error) { return res.status(500).send('Ralat Pelayan Webhook'); }
};

// ==========================================
// 4A. SEJARAH YURAN SAHAJA (Untuk Tab Yuran Ahli)
// ==========================================
export const getSejarahYuran = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        // Nota: penyegerakan status PENDING kini dibuat secara berkala oleh utils/paymentSync.js
        // (lihat setInterval di server.js) supaya GET ini sentiasa pantas dan tidak menunggu API luar.
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
        // Nota: penyegerakan status PENDING (yuran + kedai) kini dibuat secara berkala
        // oleh utils/paymentSync.js (setInterval di server.js), bukan dalam permintaan ini.

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
        const status = await semakTransaksiBil(billcode);

        if (status === 'BERJAYA') {
            await prosesYuranBerjaya(billcode);
            return res.status(200).json({ success: true, status: 'BERJAYA' });
        } else if (status === 'GAGAL') {
            await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
            return res.status(200).json({ success: true, status: 'GAGAL' });
        }
        return res.status(200).json({ success: true, status: 'PENDING' });
    } catch (error) { return res.status(500).json({ success: false, status: 'PENDING' }); }
};