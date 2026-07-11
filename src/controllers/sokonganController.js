// ============================================================
// FAIL: src/controllers/sokonganController.js
// Sistem Tiket Sokongan — Hubungi Kelab
// ============================================================
import db from '../config/db.js';
import sendEmail from '../utils/sendEmail.js';
import { KELAB, ccPengurusan } from '../config/kelab.js';

// ── Auto-Migration ──────────────────────────────────────────
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS tiket_sokongan (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                no_tiket         VARCHAR(20) NOT NULL UNIQUE,
                no_kp            VARCHAR(20) NOT NULL,
                kategori         VARCHAR(80) NOT NULL DEFAULT 'Pertanyaan Umum',
                subjek           VARCHAR(200) NOT NULL,
                kandungan        TEXT NOT NULL,
                status           ENUM('BARU','DALAM_PROSES','SELESAI','DITOLAK') NOT NULL DEFAULT 'BARU',
                catatan_penutup  TEXT DEFAULT NULL,
                tarikh_hantar    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                tarikh_kemaskini DATETIME DEFAULT NULL
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS tiket_balasan (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                id_tiket         INT NOT NULL,
                pengirim_no_kp   VARCHAR(20) NOT NULL,
                jenis            ENUM('AHLI','ADMIN') NOT NULL,
                kandungan        TEXT NOT NULL,
                tarikh           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (id_tiket) REFERENCES tiket_sokongan(id) ON DELETE CASCADE
            )
        `);
        // Tambah ref_id ke notifikasi jika belum ada
        await db.query(`ALTER TABLE notifikasi ADD COLUMN IF NOT EXISTS ref_id VARCHAR(50) DEFAULT NULL`);
        console.log('[Migration] Jadual tiket_sokongan & tiket_balasan disemak.');
    } catch (e) {
        console.error('[Migration sokongan]', e.message);
    }
})();

// ── Helper ──────────────────────────────────────────────────
const janaNoTiket = async () => {
    const tahun = new Date().getFullYear();
    const [[{ bil }]] = await db.query(
        `SELECT COUNT(*) AS bil FROM tiket_sokongan WHERE YEAR(tarikh_hantar) = ?`,
        [tahun]
    );
    return `SOK-${tahun}-${String(parseInt(bil) + 1).padStart(5, '0')}`;
};

const warnaPetaStatus = {
    BARU: '#2563eb', DALAM_PROSES: '#d97706', SELESAI: '#16a34a', DITOLAK: '#dc2626'
};
const labelPetaStatus = {
    BARU: 'Baru', DALAM_PROSES: 'Dalam Proses', SELESAI: 'Selesai', DITOLAK: 'Ditolak'
};

const hantarNotifAdmin = async (no_tiket, tajukEmel, kandungan) => {
    try {
        await sendEmail({
            email: process.env.EMAIL_USER,
            cc: ccPengurusan(),
            subject: tajukEmel,
            message: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
                    <div style="background:#081C15;padding:20px 24px;border-radius:12px 12px 0 0;">
                        <h2 style="color:#95D5B2;margin:0;font-size:16px;">🎫 ${KELAB.namaPendek} — Sistem Sokongan</h2>
                    </div>
                    <div style="background:#F8FAFC;padding:20px 24px;border:1px solid #E2E8F0;border-top:none;">
                        ${kandungan}
                        <p style="margin-top:20px;font-size:11px;color:#94a3b8;">
                            Log masuk ke <a href="${process.env.FRONTEND_URL}/admin/sokongan">panel admin</a> untuk membalas.
                        </p>
                    </div>
                </div>
            `
        });
    } catch {}
};

const hantarNotifAhli = async (emel, nama, no_tiket, subjek, tajukEmel, kandungan) => {
    if (!emel) return;
    try {
        await sendEmail({
            email: emel,
            subject: tajukEmel,
            message: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
                    <div style="background:#081C15;padding:20px 24px;border-radius:12px 12px 0 0;">
                        <h2 style="color:#95D5B2;margin:0;font-size:16px;">🎫 ${KELAB.namaPendek} — Tiket ${no_tiket}</h2>
                    </div>
                    <div style="background:#F8FAFC;padding:20px 24px;border:1px solid #E2E8F0;border-top:none;">
                        <p>Salam ${nama},</p>
                        ${kandungan}
                        <div style="margin-top:16px;padding:12px 16px;background:#FEF3C7;border-radius:8px;border-left:4px solid #F59E0B;">
                            <p style="margin:0;font-size:11px;color:#92400e;">
                                <strong>Nota Penting:</strong> Untuk membalas, sila log masuk ke aplikasi.
                                Jangan balas emel ini secara langsung kerana ia tidak dipantau.
                            </p>
                        </div>
                        <p style="margin-top:16px;font-size:11px;color:#94a3b8;">
                            Akses tiket: <a href="${process.env.FRONTEND_URL}">${process.env.FRONTEND_URL}</a>
                        </p>
                    </div>
                </div>
            `
        });
    } catch {}
};

// ── AHLI ────────────────────────────────────────────────────

export const getSenaraiTiketAhli = async (req, res) => {
    const [rows] = await db.query(`
        SELECT t.id, t.no_tiket, t.kategori, t.subjek, t.status,
               t.tarikh_hantar, t.tarikh_kemaskini,
               (SELECT COUNT(*) FROM tiket_balasan WHERE id_tiket = t.id) AS bil_balasan,
               (SELECT tarikh FROM tiket_balasan WHERE id_tiket = t.id ORDER BY tarikh DESC LIMIT 1) AS tarikh_balasan_terkini
        FROM tiket_sokongan t
        WHERE t.no_kp = ?
        ORDER BY t.tarikh_hantar DESC
    `, [req.user.no_kp]);
    res.json({ data: rows });
};

export const hantarTiketBaru = async (req, res) => {
    const { kategori, subjek, kandungan } = req.body;
    if (!subjek?.trim() || !kandungan?.trim()) {
        return res.status(400).json({ message: 'Subjek dan kandungan diperlukan.' });
    }

    const noTiket = await janaNoTiket();
    const [r] = await db.query(`
        INSERT INTO tiket_sokongan (no_tiket, no_kp, kategori, subjek, kandungan)
        VALUES (?, ?, ?, ?, ?)
    `, [noTiket, req.user.no_kp, kategori || 'Pertanyaan Umum', subjek.trim(), kandungan.trim()]);

    const [[pengirim]] = await db.query(
        `SELECT nama_pegawai AS nama, emel FROM users WHERE no_kp = ?`, [req.user.no_kp]
    );

    // Notifikasi sistem kepada pengirim — pengesahan tiket diterima
    await db.query(
        `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej, ref_id) VALUES (?, 'SOKONGAN', ?, ?, ?)`,
        [req.user.no_kp, `Tiket ${noTiket} Diterima`,
         `Pertanyaan anda (${kategori || 'Pertanyaan Umum'}) telah berjaya dihantar. Kami akan membalas melalui sistem ini. No. Tiket: ${noTiket}`,
         r.insertId]
    );

    await hantarNotifAdmin(noTiket, `[Tiket Baru] ${noTiket} — ${subjek}`, `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:6px 0;font-weight:bold;width:130px;color:#64748b;">No. Tiket</td><td>${noTiket}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#64748b;">Pengirim</td><td>${pengirim?.nama || req.user.no_kp}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#64748b;">Kategori</td><td>${kategori}</td></tr>
            <tr><td style="padding:6px 0;font-weight:bold;color:#64748b;">Subjek</td><td>${subjek}</td></tr>
        </table>
        <div style="background:white;padding:12px 16px;border-left:4px solid #0F4C3A;margin-top:12px;border-radius:4px;">
            <strong>Kandungan:</strong><br><br>${kandungan.replace(/\n/g, '<br>')}
        </div>
    `);

    res.status(201).json({ message: 'Tiket berjaya dihantar.', no_tiket: noTiket, id: r.insertId });
};

export const getDetailTiketAhli = async (req, res) => {
    const [[tiket]] = await db.query(`
        SELECT t.*, u.nama_pegawai AS nama_pengirim
        FROM tiket_sokongan t
        JOIN users u ON u.no_kp = t.no_kp
        WHERE t.id = ? AND t.no_kp = ?
    `, [req.params.id, req.user.no_kp]);
    if (!tiket) return res.status(404).json({ message: 'Tiket tidak dijumpai.' });

    const [balasan] = await db.query(`
        SELECT b.*, u.nama_pegawai AS nama_pengirim
        FROM tiket_balasan b
        JOIN users u ON u.no_kp = b.pengirim_no_kp
        WHERE b.id_tiket = ?
        ORDER BY b.tarikh ASC
    `, [tiket.id]);

    res.json({ data: { ...tiket, balasan } });
};

export const balasTiketAhli = async (req, res) => {
    const { kandungan } = req.body;
    if (!kandungan?.trim()) return res.status(400).json({ message: 'Kandungan balasan diperlukan.' });

    const [[tiket]] = await db.query(
        `SELECT * FROM tiket_sokongan WHERE id = ? AND no_kp = ?`,
        [req.params.id, req.user.no_kp]
    );
    if (!tiket) return res.status(404).json({ message: 'Tiket tidak dijumpai.' });
    if (tiket.status === 'SELESAI' || tiket.status === 'DITOLAK') {
        return res.status(400).json({ message: 'Tiket ini telah ditutup. Buka tiket baru untuk pertanyaan lanjut.' });
    }

    await db.query(`
        INSERT INTO tiket_balasan (id_tiket, pengirim_no_kp, jenis, kandungan)
        VALUES (?, ?, 'AHLI', ?)
    `, [tiket.id, req.user.no_kp, kandungan.trim()]);
    await db.query(`UPDATE tiket_sokongan SET tarikh_kemaskini = NOW() WHERE id = ?`, [tiket.id]);

    const [[pengirim]] = await db.query(`SELECT nama_pegawai AS nama FROM users WHERE no_kp = ?`, [req.user.no_kp]);
    await hantarNotifAdmin(tiket.no_tiket, `[Balasan Ahli] ${tiket.no_tiket} — ${tiket.subjek}`, `
        <p style="font-size:13px;"><strong>${pengirim?.nama || req.user.no_kp}</strong> membalas tiket <strong>${tiket.no_tiket}</strong>:</p>
        <div style="background:white;padding:12px 16px;border-left:4px solid #FBBF24;margin-top:8px;border-radius:4px;font-size:13px;">
            ${kandungan.replace(/\n/g, '<br>')}
        </div>
    `);

    res.json({ message: 'Balasan berjaya dihantar.' });
};

// ── ADMIN ────────────────────────────────────────────────────

export const getSenaraiTiketAdmin = async (req, res) => {
    const { status, kategori, cari } = req.query;
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (kategori) { where += ' AND t.kategori = ?'; params.push(kategori); }
    if (cari) {
        where += ' AND (t.no_tiket LIKE ? OR t.subjek LIKE ? OR u.nama LIKE ?)';
        const q = `%${cari}%`;
        params.push(q, q, q);
    }

    const [rows] = await db.query(`
        SELECT t.id, t.no_tiket, t.kategori, t.subjek, t.status,
               t.tarikh_hantar, t.tarikh_kemaskini,
               u.nama_pegawai AS nama_pengirim, u.no_kp,
               (SELECT COUNT(*) FROM tiket_balasan WHERE id_tiket = t.id) AS bil_balasan,
               (SELECT jenis FROM tiket_balasan WHERE id_tiket = t.id ORDER BY tarikh DESC LIMIT 1) AS jenis_balasan_terkini
        FROM tiket_sokongan t
        JOIN users u ON u.no_kp = t.no_kp
        WHERE ${where}
        ORDER BY FIELD(t.status,'BARU','DALAM_PROSES','SELESAI','DITOLAK'), t.tarikh_hantar DESC
    `, params);

    const [[{ bil_baru }]] = await db.query(
        `SELECT COUNT(*) AS bil_baru FROM tiket_sokongan WHERE status = 'BARU'`
    );
    res.json({ data: rows, bil_baru: parseInt(bil_baru) });
};

export const getDetailTiketAdmin = async (req, res) => {
    const [[tiket]] = await db.query(`
        SELECT t.*, u.nama_pegawai AS nama_pengirim, u.emel AS emel_pengirim, u.phone AS no_tel_pengirim
        FROM tiket_sokongan t
        JOIN users u ON u.no_kp = t.no_kp
        WHERE t.id = ?
    `, [req.params.id]);
    if (!tiket) return res.status(404).json({ message: 'Tiket tidak dijumpai.' });

    const [balasan] = await db.query(`
        SELECT b.*, u.nama_pegawai AS nama_pengirim
        FROM tiket_balasan b
        JOIN users u ON u.no_kp = b.pengirim_no_kp
        WHERE b.id_tiket = ?
        ORDER BY b.tarikh ASC
    `, [tiket.id]);

    res.json({ data: { ...tiket, balasan } });
};

export const balasTiketAdmin = async (req, res) => {
    const { kandungan } = req.body;
    if (!kandungan?.trim()) return res.status(400).json({ message: 'Kandungan balasan diperlukan.' });

    const [[tiket]] = await db.query(`
        SELECT t.*, u.emel AS emel_pengirim, u.nama_pegawai AS nama_pengirim
        FROM tiket_sokongan t JOIN users u ON u.no_kp = t.no_kp WHERE t.id = ?
    `, [req.params.id]);
    if (!tiket) return res.status(404).json({ message: 'Tiket tidak dijumpai.' });
    if (tiket.status === 'SELESAI' || tiket.status === 'DITOLAK') {
        return res.status(400).json({ message: 'Tiket ini telah ditutup.' });
    }

    // Auto-update BARU → DALAM_PROSES pada balasan pertama admin
    if (tiket.status === 'BARU') {
        await db.query(
            `UPDATE tiket_sokongan SET status = 'DALAM_PROSES', tarikh_kemaskini = NOW() WHERE id = ?`,
            [tiket.id]
        );
    } else {
        await db.query(`UPDATE tiket_sokongan SET tarikh_kemaskini = NOW() WHERE id = ?`, [tiket.id]);
    }

    const [[admin]] = await db.query(`SELECT nama_pegawai AS nama FROM users WHERE no_kp = ?`, [req.user.no_kp]);
    await db.query(`
        INSERT INTO tiket_balasan (id_tiket, pengirim_no_kp, jenis, kandungan)
        VALUES (?, ?, 'ADMIN', ?)
    `, [tiket.id, req.user.no_kp, kandungan.trim()]);

    // Notifikasi sistem kepada ahli — ada balasan baru
    await db.query(
        `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej, ref_id) VALUES (?, 'SOKONGAN', ?, ?, ?)`,
        [tiket.no_kp, `Maklum Balas Tiket ${tiket.no_tiket}`,
         `Urusetia telah membalas pertanyaan anda: "${tiket.subjek}". Log masuk untuk melihat balasan.`,
         tiket.id]
    );

    await hantarNotifAhli(
        tiket.emel_pengirim, tiket.nama_pengirim, tiket.no_tiket, tiket.subjek,
        `[Maklum Balas] ${tiket.no_tiket} — ${tiket.subjek}`,
        `
        <p>Terdapat maklum balas baharu bagi tiket anda:</p>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:4px 0;font-weight:bold;width:120px;color:#64748b;">No. Tiket</td><td>${tiket.no_tiket}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#64748b;">Subjek</td><td>${tiket.subjek}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#64748b;">Dijawab oleh</td><td>${admin?.nama || 'Urusetia'}</td></tr>
        </table>
        <div style="background:white;padding:12px 16px;border-left:4px solid #0F4C3A;margin-top:12px;border-radius:4px;font-size:13px;">
            ${kandungan.replace(/\n/g, '<br>')}
        </div>
        `
    );

    res.json({ message: 'Balasan berjaya dihantar.' });
};

export const kemaskiniStatusTiket = async (req, res) => {
    const { status, catatan_penutup } = req.body;
    const statusSah = ['BARU', 'DALAM_PROSES', 'SELESAI', 'DITOLAK'];
    if (!statusSah.includes(status)) return res.status(400).json({ message: 'Status tidak sah.' });

    const [[tiket]] = await db.query(`
        SELECT t.*, u.emel AS emel_pengirim, u.nama_pegawai AS nama_pengirim
        FROM tiket_sokongan t JOIN users u ON u.no_kp = t.no_kp WHERE t.id = ?
    `, [req.params.id]);
    if (!tiket) return res.status(404).json({ message: 'Tiket tidak dijumpai.' });

    await db.query(`
        UPDATE tiket_sokongan SET status = ?, catatan_penutup = ?, tarikh_kemaskini = NOW() WHERE id = ?
    `, [status, catatan_penutup || null, tiket.id]);

    // Notifikasi sistem kepada ahli — status dikemaskini
    const labelStatus = { BARU: 'Baru', DALAM_PROSES: 'Dalam Proses', SELESAI: 'Selesai', DITOLAK: 'Ditolak' };
    await db.query(
        `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej, ref_id) VALUES (?, 'SOKONGAN', ?, ?, ?)`,
        [tiket.no_kp,
         `Status Tiket ${tiket.no_tiket} Dikemaskini`,
         `Status pertanyaan anda telah ditukar kepada "${labelStatus[status] || status}"${catatan_penutup ? `: ${catatan_penutup}` : '.'}`,
         tiket.id]
    );

    await hantarNotifAhli(
        tiket.emel_pengirim, tiket.nama_pengirim, tiket.no_tiket, tiket.subjek,
        `[Kemaskini Status] ${tiket.no_tiket} — ${tiket.subjek}`,
        `
        <p>Status tiket anda telah dikemaskini:</p>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:4px 0;font-weight:bold;width:120px;color:#64748b;">No. Tiket</td><td>${tiket.no_tiket}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#64748b;">Subjek</td><td>${tiket.subjek}</td></tr>
            <tr><td style="padding:4px 0;font-weight:bold;color:#64748b;">Status Baharu</td>
                <td><strong style="color:${warnaPetaStatus[status]}">${labelPetaStatus[status]}</strong></td></tr>
        </table>
        ${catatan_penutup ? `
        <div style="background:white;padding:12px 16px;border-left:4px solid ${warnaPetaStatus[status]};margin-top:12px;border-radius:4px;font-size:13px;">
            <strong>Nota:</strong><br>${catatan_penutup.replace(/\n/g, '<br>')}
        </div>` : ''}
        `
    );

    res.json({ message: 'Status tiket berjaya dikemaskini.' });
};
