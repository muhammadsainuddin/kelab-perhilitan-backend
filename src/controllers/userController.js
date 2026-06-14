import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';
import sendEmail from '../utils/sendEmail.js';
import { KELAB, footerEmelHTML } from '../config/kelab.js';

// ==========================================
// 1. Ambil Profil & Logik Status Berbayar
// ==========================================
export const getMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;

    try {
        const query = `
            SELECT 
                u.no_kp, 
                u.nama_pegawai AS nama_penuh, 
                u.gred_penyandang_sspa AS gred_sspa, 
                p.nama_penempatan AS penempatan, 
                u.penempatan_id,
                u.emel AS email, 
                u.phone AS no_tel, 
                u.saiz_baju, 
                u.jenis_potongan AS pilihan_potongan, 
                u.yuran_kelab_bulanan,
                u.no_akaun_bank AS no_acc_bank, 
                u.nama_bank AS bank_ahli,
                u.nama_waris, 
                u.no_phone_waris AS no_tel_waris, 
                u.akaun_bank_waris AS no_acc_waris,
                u.nama_bank_waris AS bank_waris,
                u.status_ahli,
                u.no_ahli,
                u.gambar,
                u.role,
                u.jawatan_kelab
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui." });
        }

        let profil = rows[0];

        // Tentukan status berbayar melalui helper bersama:
        //  - Potongan Biro angkasa -> sentiasa berbayar
        //  - Bayar secara manual    -> semak sejarah_bayaran tahun semasa
        const isPaid = await semakStatusBerbayar(no_kp, profil.pilihan_potongan);

        profil.is_paid = isPaid;
        profil.yuran_tertunggak = !isPaid;
        profil.status_yuran = isPaid ? 'AHLI BERBAYAR' : 'YURAN TERTUNGGAK';

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil." });
    }
};

// ==========================================
// 2. Kemaskini Profil
// ==========================================
export const updateMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { 
        email, no_tel, saiz_baju, nama_waris, no_tel_waris,
        no_acc_waris, bank_waris, penempatan_id,
        no_acc_bank, bank_ahli
    } = req.body;

    try {
        const query = `
            UPDATE users 
            SET emel = ?, 
                phone = ?, 
                saiz_baju = IFNULL(?, saiz_baju), 
                nama_waris = IFNULL(?, nama_waris), 
                no_phone_waris = IFNULL(?, no_phone_waris), 
                akaun_bank_waris = IFNULL(?, akaun_bank_waris),
                nama_bank_waris = IFNULL(?, nama_bank_waris), 
                penempatan_id = IFNULL(?, penempatan_id), 
                no_akaun_bank = IFNULL(?, no_akaun_bank),
                nama_bank = IFNULL(?, nama_bank)
            WHERE no_kp = ?
        `;
        
        await db.query(query, [
            email, no_tel, saiz_baju, nama_waris, no_tel_waris,
            no_acc_waris, bank_waris, penempatan_id, 
            no_acc_bank, bank_ahli, no_kp
        ]);

        if (req.body.kata_laluan) {
            const hashedPassword = await bcrypt.hash(req.body.kata_laluan, 10);
            await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashedPassword, no_kp]);
        }

        res.status(200).json({ success: true, message: "Maklumat profil anda berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Profil:", error);
        res.status(500).json({ success: false, message: "Gagal mengemaskini profil." });
    }
};

// ==========================================
// 3. Tarik Senarai PTJ (Lokasi Penempatan)
// ==========================================
export const getSenaraiPTJ = async (req, res) => {
    try {
        // Ambil semua PTJ dengan induk_id untuk bina hierarki
        const [ptj] = await db.query(`
            SELECT id, nama_penempatan, induk_id
            FROM penempatan
            ORDER BY COALESCE(induk_id, id) ASC, induk_id IS NOT NULL ASC, nama_penempatan ASC
        `);
        res.status(200).json({ success: true, data: ptj });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik senarai PTJ." });
    }
};

// ==========================================
// 4. Permohonan Berhenti Ahli
// ==========================================
export const getStatusBerhenti = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [rows] = await db.query(
            `SELECT id, status_permohonan, catatan_admin, sebab_berhenti, tarikh_mohon
             FROM berhenti_ahli WHERE no_kp = ? ORDER BY tarikh_mohon DESC LIMIT 1`,
            [no_kp]
        );
        res.json({ success: true, data: rows[0] || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ralat pelayan.' });
    }
};

export const applyResignation = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { sebab_berhenti } = req.body;

    try {
        const [existing] = await db.query(
            `SELECT id FROM berhenti_ahli WHERE no_kp = ? AND status_permohonan = 'MENUNGGU'`,
            [no_kp]
        );
        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Anda sudah mempunyai permohonan berhenti yang sedang dalam semakan.'
            });
        }

        await db.query(`INSERT INTO berhenti_ahli (no_kp, sebab_berhenti) VALUES (?, ?)`, [no_kp, sebab_berhenti]);

        res.status(200).json({ success: true, message: "Permohonan berhenti telah dihantar kepada urusetia untuk semakan." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan berhenti." });
    }
};

// ==========================================
// 5. Tukar Password
// ==========================================
export const changePassword = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { oldPassword, newPassword } = req.body;

    try {
        const [user] = await db.query(`SELECT password FROM users WHERE no_kp = ?`, [no_kp]);
        
        if (user.length === 0) {
            return res.status(404).json({ success: false, message: "Akaun tidak dijumpai." });
        }

        const isMatch = await bcrypt.compare(oldPassword, user[0].password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Kata laluan lama salah." });

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ success: false, message: "Kata laluan baru mestilah sekurang-kurangnya 8 aksara." });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashed, no_kp]);

        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menukar kata laluan." });
    }
};

// ==========================================
// 6. Muat Naik Gambar Profil
// ==========================================
export const updateGambarProfil = async (req, res) => {
    const no_kp = req.user.no_kp;

    if (!req.file) return res.status(400).json({ success: false, message: "Tiada fail gambar dijumpai." });

    try {
        await db.query(`UPDATE users SET gambar = ? WHERE no_kp = ?`, [req.file.filename, no_kp]);
        res.status(200).json({ success: true, message: "Gambar profil berjaya dikemas kini!", gambar: req.file.filename });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menyimpan gambar. Sila cuba lagi." });
    }
};

// ==========================================
// Hubungi Kelab — ahli hantar pertanyaan/bantuan
// ==========================================
export const hubungiKelab = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { subjek, mesej } = req.body;

    if (!subjek || !mesej || !mesej.trim()) {
        return res.status(400).json({ success: false, message: 'Subjek dan mesej wajib diisi.' });
    }

    try {
        const [[ahli]] = await db.query(
            `SELECT u.nama_pegawai, u.emel, u.phone, u.no_ahli, p.nama_penempatan
             FROM users u LEFT JOIN penempatan p ON u.penempatan_id = p.id
             WHERE u.no_kp = ?`,
            [no_kp]
        );

        const tarikhHantar = new Date().toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'full', timeStyle: 'short' });

        const htmlKelab = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
              <div style="background:#081C15;padding:24px 28px;">
                <h2 style="margin:0;color:#95D5B2;font-size:18px;letter-spacing:1px;">PERTANYAAN / BANTUAN AHLI</h2>
                <p style="margin:6px 0 0;color:rgba(149,213,178,0.6);font-size:12px;">${KELAB.namaPendek}</p>
              </div>
              <div style="padding:24px 28px;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
                  <tr style="background:#f8fafc;"><td style="padding:8px 12px;font-weight:bold;color:#64748b;width:140px;">Nama Ahli</td><td style="padding:8px 12px;color:#0f172a;">${ahli.nama_pegawai || '-'}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#64748b;">No. Ahli</td><td style="padding:8px 12px;color:#0f172a;">${ahli.no_ahli || '-'}</td></tr>
                  <tr style="background:#f8fafc;"><td style="padding:8px 12px;font-weight:bold;color:#64748b;">No. KP</td><td style="padding:8px 12px;color:#0f172a;">${no_kp}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#64748b;">Penempatan</td><td style="padding:8px 12px;color:#0f172a;">${ahli.nama_penempatan || '-'}</td></tr>
                  <tr style="background:#f8fafc;"><td style="padding:8px 12px;font-weight:bold;color:#64748b;">No. Telefon</td><td style="padding:8px 12px;color:#0f172a;">${ahli.phone || '-'}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#64748b;">E-mel Ahli</td><td style="padding:8px 12px;color:#0f172a;">${ahli.emel || '-'}</td></tr>
                  <tr style="background:#f8fafc;"><td style="padding:8px 12px;font-weight:bold;color:#64748b;">Subjek</td><td style="padding:8px 12px;font-weight:bold;color:#1b4332;">${subjek}</td></tr>
                  <tr><td style="padding:8px 12px;font-weight:bold;color:#64748b;">Tarikh</td><td style="padding:8px 12px;color:#0f172a;">${tarikhHantar}</td></tr>
                </table>
                <div style="background:#f8fafc;border-left:4px solid #52B788;border-radius:4px;padding:16px 18px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Mesej</p>
                  <p style="margin:0;font-size:13px;color:#0f172a;line-height:1.7;white-space:pre-wrap;">${mesej.trim()}</p>
                </div>
              </div>
              ${footerEmelHTML()}
            </div>`;

        await sendEmail({
            email: KELAB.emel,
            subject: `[Pertanyaan Ahli] ${subjek} — ${ahli.nama_pegawai || no_kp}`,
            message: htmlKelab,
        });

        // Hantar pengesahan kepada ahli jika ada emel
        if (ahli.emel) {
            const htmlAhli = `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
                  <div style="background:#081C15;padding:24px 28px;">
                    <h2 style="margin:0;color:#95D5B2;font-size:18px;">Pertanyaan Anda Telah Diterima</h2>
                  </div>
                  <div style="padding:24px 28px;font-size:13px;color:#0f172a;line-height:1.8;">
                    <p>Assalamualaikum <strong>${ahli.nama_pegawai || 'Ahli'}</strong>,</p>
                    <p>Pertanyaan anda bertajuk <strong>"${subjek}"</strong> telah diterima oleh Urusetia ${KELAB.namaPendek} pada ${tarikhHantar}.</p>
                    <p>Kami akan menghubungi anda dalam masa terdekat. Sekiranya mendesak, sila hubungi kami terus di:</p>
                    <p style="margin:12px 0;"><strong>E-mel:</strong> ${KELAB.emel}<br/><strong>Tel:</strong> 03-9075 2872</p>
                    <p>Terima kasih.</p>
                  </div>
                  ${footerEmelHTML()}
                </div>`;
            await sendEmail({ email: ahli.emel, subject: `Pertanyaan Diterima — ${subjek}`, message: htmlAhli });
        }

        res.json({ success: true, message: 'Mesej anda telah dihantar kepada pihak kelab.' });
    } catch (error) {
        console.error('Ralat hubungi kelab:', error);
        res.status(500).json({ success: false, message: 'Gagal menghantar mesej. Sila cuba lagi.' });
    }
};