import db from '../config/db.js';
import sendEmail from '../utils/sendEmail.js';
import { KELAB, footerEmelHTML, ccPengurusan } from '../config/kelab.js';

// ==========================================
// 1. Semak Profil & Status Keahlian Kelab
// ==========================================
export const checkStatus = async (req, res) => {
    const no_kp = req.user.no_kp; 

    try {
        // TUKAR: k.penempatan kepada k.nama_majikan
        // Kita guna "AS penempatan" supaya jika frontend cari 'penempatan', ia masih berfungsi
        const query = `
            SELECT k.nama_penuh, k.nama_majikan AS penempatan, k.yuran_bulanan, k.status_ahli, k.no_ahli, k.pilihan_potongan
            FROM keahlian_kelab k
            WHERE k.no_kp = ?
        `;
        const [ahli] = await db.query(query, [no_kp]);

        if (ahli.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Anda belum mendaftar sebagai ahli kelab. Sila isi borang keahlian." 
            });
        }

        res.status(200).json({
            success: true,
            data: ahli[0] 
        });

    } catch (error) {
        console.error("Semak Status Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 2. Mohon Bantuan Kebajikan
// ==========================================
export const mohonBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { jenis_bantuan, keterangan } = req.body;
    
    // Jika ada sistem upload fail sokongan, kita akan ambil dari req.file
    const dokumen_sokongan = req.file ? req.file.filename : null; 

    try {
        const query = `
            INSERT INTO bantuan_kebajikan (no_kp, jenis_bantuan, keterangan, dokumen_sokongan) 
            VALUES (?, ?, ?, ?)
        `;
        await db.query(query, [no_kp, jenis_bantuan, keterangan, dokumen_sokongan]);

        res.status(201).json({ 
            success: true, 
            message: "Permohonan Bantuan Kebajikan berjaya dihantar dan sedang diproses." 
        });

    } catch (error) {
        console.error("Mohon Bantuan Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. Mohon Berhenti Ahli
// ==========================================
export const mohonBerhenti = async (req, res) => {
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

        // Hantar notifikasi emel kepada admin + CC pengurusan
        try {
            const [[ahli]] = await db.query(
                `SELECT nama_pegawai, emel, no_ahli FROM users WHERE no_kp = ?`, [no_kp]
            );
            await sendEmail({
                email: KELAB.emel,
                cc: ccPengurusan(),
                subject: `[Kelab PERHILITAN] Permohonan Berhenti Ahli — ${ahli?.nama_pegawai || no_kp}`,
                message: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
  <div style="background:#7F1D1D;padding:24px;text-align:center;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Permohonan Berhenti Ahli</h2>
    <p style="color:#fca5a5;font-size:11px;margin:4px 0 0;">Kelab PERHILITAN — Sistem Pengurusan Ahli</p>
  </div>
  <div style="padding:24px;background:#fff;color:#1e293b;font-size:13px;line-height:1.7;">
    <p>Terdapat permohonan berhenti ahli yang memerlukan tindakan:</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;">
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;font-weight:bold;width:40%;">Nama</td><td style="padding:8px 0;">${ahli?.nama_pegawai || '—'}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;font-weight:bold;">No. Kad Pengenalan</td><td style="padding:8px 0;font-family:monospace;">${no_kp}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 0;color:#64748b;font-weight:bold;">No. Ahli</td><td style="padding:8px 0;">${ahli?.no_ahli || '—'}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-weight:bold;vertical-align:top;">Sebab Berhenti</td><td style="padding:8px 0;">${sebab_berhenti || '(tiada sebab dinyatakan)'}</td></tr>
    </table>
    <p style="margin-top:18px;font-size:12px;color:#64748b;">Sila log masuk ke panel pentadbir untuk memproses permohonan ini.</p>
  </div>
  ${footerEmelHTML()}
</div>`
            });
        } catch { /* emel gagal tidak henti proses */ }

        res.status(201).json({
            success: true,
            message: "Permohonan berhenti ahli telah dihantar kepada urusetia."
        });

    } catch (error) {
        console.error("Mohon Berhenti Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};