import db from '../config/db.js';
import axios from 'axios';

// ==========================================
// KONFIGURASI TOYYIBPAY (PERSEKITARAN DEV / SANDBOX)
// ==========================================
const TOYYIBPAY_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';
const SECRET_KEY = process.env.SECRET_KEY || 'g0jw4dtf-1mgf-l4au-les2-se8kpdg9beoe'; 
const CATEGORY_CODE = process.env.CATEGORY_CODE || 'v4vftvzw'; 

// ==========================================
// 1. CIPTA BIL (DIKEMASKINI DENGAN KESELAMATAN BACKEND)
// ==========================================
export const ciptaBil = async (req, res) => {
    const no_kp = req.user.no_kp;
    const user_id = req.user.id;
    
    let { keterangan, amaun, jenis_bayaran } = req.body; 
    
    console.log(`[FPX] Memulakan cipta bil untuk IC: ${no_kp}, Jenis: ${jenis_bayaran}`);

    try {
        // --- LOGIK SEMAKAN TRANSAKSI PENDING (15 MINIT BLOCKER) ---
        const [pendingBills] = await db.query(`
            SELECT billCode, tarikh_cipta, TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) as minit_berlalu 
            FROM sejarah_bayaran 
            WHERE no_kp = ? AND status = 'PENDING' 
            ORDER BY tarikh_cipta DESC LIMIT 1
        `, [no_kp]);

        if (pendingBills.length > 0) {
            const pending = pendingBills[0];
            if (pending.minit_berlalu < 15) {
                const bakiMinit = 15 - pending.minit_berlalu;
                return res.status(400).json({ 
                    success: false, 
                    message: `Anda mempunyai transaksi yang sedang diproses. Sila tunggu ${bakiMinit} minit lagi sebelum mencuba semula.` 
                });
            } else {
                await db.query(
                    `UPDATE sejarah_bayaran SET status = 'DIBATALKAN', keterangan = CONCAT(keterangan, ' (Expired)') WHERE billCode = ?`, 
                    [pending.billCode]
                );
            }
        }

        // --- TARIK MAKLUMAT DARI DATABASE (Cegah Hack Frontend) ---
        const [users] = await db.query(`
            SELECT nama_pegawai, emel, phone, gred_penyandang_sspa, yuran_kelab_bulanan 
            FROM users 
            WHERE no_kp = ?
        `, [no_kp]);

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Data kakitangan tidak dijumpai dalam sistem." });
        }

        const user = users[0];
        let finalAmaun = parseFloat(amaun);

        // --- LOGIK KESELAMATAN: PAKSA KIRAAN DARI DATABASE JIKA YURAN ---
        if (jenis_bayaran === 'YURAN') {
            let yuranBulanan = parseFloat(user.yuran_kelab_bulanan || 0);
            
            if (yuranBulanan <= 0) {
                const gred = (user.gred_penyandang_sspa || '').toUpperCase();
                if (gred.includes('JUSA') || gred.includes('VU') || gred.includes('VK') || gred.includes('UTAMA')) {
                    yuranBulanan = 15.00;
                } else {
                    const match = gred.match(/\d+/);
                    if (match) {
                        const num = parseInt(match[0], 10);
                        if (num >= 9 && num <= 14) yuranBulanan = 10.00;
                        else if (num >= 1 && num <= 8) yuranBulanan = 5.00;
                        else yuranBulanan = 5.00;
                    } else {
                        yuranBulanan = 5.00;
                    }
                }
            }

            finalAmaun = yuranBulanan * 12; 
            keterangan = `Yuran Tahunan Kelab Sesi ${new Date().getFullYear()}`;
        }

        if (!finalAmaun || finalAmaun <= 0) {
            return res.status(400).json({ success: false, message: "Ralat: Jumlah bayaran tidak sah (RM0.00)." });
        }

        const amountInCents = Math.round(finalAmaun * 100);
        const currentFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const currentBackendUrl = process.env.BACKEND_URL || 'http://localhost:5001';

        const contentEmailResit = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #08151D; color: #87BCB5; padding: 24px; text-align: center;">
                    <h2 style="margin: 0; font-size: 18px; text-transform: uppercase;">Resit Rasmi Pembayaran</h2>
                    <p style="margin: 4px 0 0; font-size: 11px; color: #D0D7D7;">KELAB PERHILITAN MALAYSIA</p>
                </div>
                <div style="padding: 24px; color: #333333; line-height: 1.5; font-size: 13px;">
                    <p>Salam Sejahtera <b>${user.nama_pegawai}</b>,</p>
                    <p>Transaksi anda telah berjaya diproses secara selamat menerusi gerbang FPX ToyyibPay.</p>
                    <div style="background-color: #f8f9fa; border: 1px solid #eaeded; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">BUTIRAN BIL:</td><td style="padding: 4px 0; font-weight: bold; text-align: right;">${keterangan}</td></tr>
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">JUMLAH:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #08151D; font-size: 14px;">RM ${finalAmaun.toFixed(2)}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        `;

        const formData = new URLSearchParams();
        formData.append('userSecretKey', SECRET_KEY);
        formData.append('categoryCode', CATEGORY_CODE);
        formData.append('billName', jenis_bayaran === 'YURAN' ? 'Yuran Kelab PERHILITAN' : 'Kedai Kelab PERHILITAN'); 
        formData.append('billDescription', `${keterangan}`);
        formData.append('billPriceSetting', 1);
        formData.append('billPayorInfo', 1);
        formData.append('billAmount', amountInCents.toString()); 
        formData.append('billReturnUrl', `${currentFrontendUrl}/dashboard/${jenis_bayaran === 'YURAN' ? 'yuran' : 'kedai'}`); 
        formData.append('billCallbackUrl', `${currentBackendUrl}/api/bayaran/callback`); 
        formData.append('billExternalReferenceNo', `INV-${no_kp}-${Date.now()}`);
        formData.append('billTo', user.nama_pegawai);
        formData.append('billEmail', user.emel || 'kelabperhilitan@gmail.com');
        formData.append('billPhone', user.phone || '0123456789');
        formData.append('billSplitPayment', 0);
        formData.append('billPaymentChannel', '0'); 
        formData.append('billContentEmail', contentEmailResit); 
        formData.append('billChargeToCustomer', 1);

        const response = await axios.post(TOYYIBPAY_URL, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const billCode = response.data[0]?.BillCode;
        if (!billCode) throw new Error("ToyyibPay tidak memulangkan BillCode");

        const billUrl = `https://dev.toyyibpay.com/${billCode}`;

        // SIMPAN di sejarah_bayaran dengan user_id
        await db.query(
            'INSERT INTO sejarah_bayaran (no_kp, user_id, billCode, amaun, status, keterangan, tarikh_cipta) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [no_kp, user_id, billCode, finalAmaun, 'PENDING', keterangan]
        );

        res.status(200).json({ success: true, bill_url: billUrl });

    } catch (error) {
        console.error("🔴 [FPX ERROR]:", error?.response?.data || error.message);
        res.status(500).json({ success: false, message: "Gagal memproses pembayaran. Sila cuba lagi sebentar lagi." });
    }
};

// ==========================================
// 2. WEBHOOK CALLBACK (DIPANGGIL OLEH BANK SECARA BACKGROUND)
// ==========================================
export const toyyibpayCallback = async (req, res) => {
    const { status_id, billcode } = req.body;
    console.log(`[WEBHOOK] Isyarat diterima: BillCode ${billcode}, Status ${status_id}`);

    try {
        if (status_id == 1) { 
            const [bayaran] = await db.query(
                'SELECT no_kp, status FROM sejarah_bayaran WHERE billCode = ?', 
                [billcode]
            );
            
            if (bayaran.length > 0 && bayaran[0].status !== 'BERJAYA') {
                const { no_kp } = bayaran[0];

                // UPDATE jadual users untuk status_ahli
                const [ahli] = await db.query(
                    'SELECT id, status_ahli, no_ahli FROM users WHERE no_kp = ?', 
                    [no_kp]
                );

                if (ahli.length > 0) {
                    let noAhliBaru = ahli[0].no_ahli;
                    
                    // Jana no_ahli baru jika belum ada
                    if (!noAhliBaru || noAhliBaru.trim() === '') {
                        noAhliBaru = await janaNoAhliBaru();
                    }

                    // UPDATE hanya jadual users
                    await db.query(
                        'UPDATE users SET status_ahli = "aktif", no_ahli = ? WHERE no_kp = ?', 
                        [noAhliBaru, no_kp]
                    );
                }

                // Tandakan resit sebagai berjaya
                await db.query(
                    'UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', 
                    [billcode]
                );
            }
            return res.status(200).send('OK');
        } else {
            await db.query(
                'UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', 
                [billcode]
            );
            return res.status(200).send('OK');
        }
    } catch (error) {
        console.error('🔴 [WEBHOOK ERROR]:', error);
        return res.status(500).send('Ralat Pelayan Webhook');
    }
};

// ==========================================
// 3. DAPATKAN SEJARAH PEMBAYARAN AHLI (AUTO CLEANUP)
// ==========================================
export const getSejarahBayaran = async (req, res) => {
    const no_kp = req.user.no_kp;

    try {
        // Auto-tamatkan transaksi PENDING yang dah lebih 15 minit
        await db.query(`
            UPDATE sejarah_bayaran 
            SET status = 'DIBATALKAN', keterangan = CONCAT(keterangan, ' (Expired)')
            WHERE no_kp = ? AND status = 'PENDING' AND TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) >= 15
        `, [no_kp]);

        const [rows] = await db.query(`
            SELECT 
                billCode, 
                amaun, 
                status, 
                keterangan, 
                DATE_FORMAT(tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh
            FROM sejarah_bayaran 
            WHERE no_kp = ? 
            ORDER BY tarikh_cipta DESC
        `, [no_kp]);
        
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("🔴 [API ERROR] Gagal tarik sejarah:", error.message);
        res.status(500).json({ success: false, message: "Gagal menarik sejarah pembayaran." });
    }
};

// ==========================================
// 4. SEMAKAN MANUAL API (DIGUNAKAN OLEH AUTO-POLLING FRONTEND)
// ==========================================
export const semakStatusBayaran = async (req, res) => {
    const { billcode } = req.params;

    try {
        const formData = new URLSearchParams();
        formData.append('billCode', billcode);

        const toyyibRes = await axios.post(
            'https://dev.toyyibpay.com/index.php/api/getBillTransactions', 
            formData.toString(), 
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (!toyyibRes.data || toyyibRes.data.length === 0) {
            return res.status(200).json({ success: true, status: 'PENDING' });
        }

        const successfulTx = toyyibRes.data.find(tx => tx.billpaymentStatus == '1');

        if (successfulTx) {
            const [bayaran] = await db.query(
                'SELECT no_kp, status FROM sejarah_bayaran WHERE billCode = ?', 
                [billcode]
            );
            
            if (bayaran.length > 0 && bayaran[0].status !== 'BERJAYA') {
                const { no_kp } = bayaran[0];
                
                // UPDATE jadual users
                const [ahli] = await db.query(
                    'SELECT id, status_ahli, no_ahli FROM users WHERE no_kp = ?', 
                    [no_kp]
                );

                if (ahli.length > 0) {
                    let noAhliBaru = ahli[0].no_ahli;
                    
                    if (!noAhliBaru || noAhliBaru.trim() === '') {
                        noAhliBaru = await janaNoAhliBaru();
                    }

                    // UPDATE hanya jadual users
                    await db.query(
                        'UPDATE users SET status_ahli = "aktif", no_ahli = ? WHERE no_kp = ?', 
                        [noAhliBaru, no_kp]
                    );
                }

                await db.query(
                    'UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', 
                    [billcode]
                );
            }
            return res.status(200).json({ success: true, status: 'BERJAYA' });

        } else {
            const failedTx = toyyibRes.data.find(tx => tx.billpaymentStatus == '3');
            if (failedTx) {
                await db.query(
                    'UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', 
                    [billcode]
                );
                return res.status(200).json({ success: true, status: 'GAGAL' });
            }
            return res.status(200).json({ success: true, status: 'PENDING' });
        }
    } catch (error) {
        console.error('🔴 [SEMAK ERROR]:', error.message);
        return res.status(500).json({ success: false, status: 'PENDING' });
    }
};

// ==========================================
// HELPER: Jana No. Ahli Baharu Secara Automatik
// ==========================================
const janaNoAhliBaru = async () => {
    const tahun = new Date().getFullYear();
    const pattern = `KP-%-${tahun}`;
    const [lastRecord] = await db.query(
        'SELECT no_ahli FROM users WHERE no_ahli LIKE ? ORDER BY no_ahli DESC LIMIT 1', 
        [pattern]
    );

    let nextNum = 1;
    if (lastRecord.length > 0 && lastRecord[0].no_ahli) {
        try {
            const parts = lastRecord[0].no_ahli.split('-');
            if (parts.length >= 3) nextNum = parseInt(parts[1], 10) + 1;
        } catch (err) {
            nextNum = 1;
        }
    }

    return `KP-${nextNum.toString().padStart(4, '0')}-${tahun}`;
};