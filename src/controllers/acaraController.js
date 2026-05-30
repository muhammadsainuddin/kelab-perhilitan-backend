import db from '../config/db.js';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';

// =====================================================================
// acaraController.js
// Letak di: src/controllers/acaraController.js
//
// BAHAGIAN A: Untuk AHLI  (lihat acara aktif, daftar, batal)
// BAHAGIAN B: Untuk ADMIN (cipta, senarai, kemaskini, peserta, padam)
// =====================================================================


// =====================================================================
// BAHAGIAN A — AHLI
// =====================================================================

// A1. Senarai acara AKTIF + tanda jika ahli ini sudah daftar
export const senaraiAcaraAktif = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [acara] = await db.query(`
            SELECT 
                a.id, a.nama_acara, a.jenis_acara, a.keterangan, a.lokasi,
                a.tarikh_acara, a.tarikh_tutup, a.poster, 
                a.emel_urusetia, a.no_tel_urusetia, a.status,
                (SELECT COUNT(*) FROM penyertaan_acara p WHERE p.acara_id = a.id) AS jumlah_peserta,
                EXISTS (
                    SELECT 1 FROM penyertaan_acara p2 
                    WHERE p2.acara_id = a.id AND p2.no_kp = ?
                ) AS sudah_daftar
            FROM acara a
            WHERE a.status = 'AKTIF'
            ORDER BY a.tarikh_acara ASC
        `, [no_kp]);

        res.status(200).json({ success: true, data: acara });
    } catch (error) {
        console.error("Ralat Senarai Acara:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai acara." });
    }
};

// A2. Ahli daftar acara (hanya ahli berbayar dibenarkan)
export const sertaiAcara = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { acara_id, kategori, catatan } = req.body;

    try {
        // Semak status berbayar
        const [users] = await db.query(
            `SELECT jenis_potongan FROM users WHERE no_kp = ?`, [no_kp]
        );
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Akaun tidak dijumpai." });
        }

        const isPaid = await semakStatusBerbayar(no_kp, users[0].jenis_potongan);
        if (!isPaid) {
            return res.status(403).json({ 
                success: false, 
                message: "Sila jelaskan yuran tahunan terlebih dahulu sebelum mendaftar acara." 
            });
        }

        // Semak acara wujud & masih AKTIF
        const [acara] = await db.query(
            `SELECT id, status, tarikh_tutup FROM acara WHERE id = ?`, [acara_id]
        );
        if (acara.length === 0) {
            return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });
        }
        if (acara[0].status !== 'AKTIF') {
            return res.status(400).json({ success: false, message: "Pendaftaran acara ini telah ditutup." });
        }
        // Semak tarikh tutup (jika ada)
        if (acara[0].tarikh_tutup) {
            const tutup = new Date(acara[0].tarikh_tutup);
            const hariIni = new Date();
            hariIni.setHours(0, 0, 0, 0);
            if (tutup < hariIni) {
                return res.status(400).json({ success: false, message: "Tarikh tutup pendaftaran telah berlalu." });
            }
        }

        // Semak sudah daftar
        const [sedia] = await db.query(
            `SELECT id FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`,
            [acara_id, no_kp]
        );
        if (sedia.length > 0) {
            return res.status(400).json({ success: false, message: "Anda sudah mendaftar untuk acara ini." });
        }

        await db.query(
            `INSERT INTO penyertaan_acara (acara_id, no_kp, kategori, catatan) VALUES (?, ?, ?, ?)`,
            [acara_id, no_kp, kategori || null, catatan || null]
        );

        res.status(201).json({ success: true, message: "Pendaftaran acara berjaya direkodkan!" });
    } catch (error) {
        console.error("Ralat Sertai Acara:", error);
        res.status(500).json({ success: false, message: "Gagal mendaftar acara." });
    }
};

// A3. Ahli batal pendaftaran (sebelum acara)
export const batalSertai = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { acara_id } = req.params;

    try {
        const [hasil] = await db.query(
            `DELETE FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`,
            [acara_id, no_kp]
        );

        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Rekod pendaftaran tidak dijumpai." });
        }

        res.status(200).json({ success: true, message: "Pendaftaran acara anda telah dibatalkan." });
    } catch (error) {
        console.error("Ralat Batal Sertai:", error);
        res.status(500).json({ success: false, message: "Gagal membatalkan pendaftaran." });
    }
};


// =====================================================================
// BAHAGIAN B — ADMIN
// =====================================================================

// B1. Cipta acara baru
export const ciptaAcara = async (req, res) => {
    const { 
        nama_acara, jenis_acara, keterangan, lokasi, 
        tarikh_acara, tarikh_tutup, emel_urusetia, no_tel_urusetia 
    } = req.body;

    const poster = req.file ? req.file.filename : null;

    if (!nama_acara || nama_acara.trim() === '') {
        return res.status(400).json({ success: false, message: "Nama acara wajib diisi." });
    }

    try {
        const [result] = await db.query(`
            INSERT INTO acara 
            (nama_acara, jenis_acara, keterangan, lokasi, tarikh_acara, tarikh_tutup, poster, emel_urusetia, no_tel_urusetia, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF')
        `, [
            nama_acara, jenis_acara || null, keterangan || null, lokasi || null,
            tarikh_acara || null, tarikh_tutup || null, poster,
            emel_urusetia || null, no_tel_urusetia || null
        ]);

        res.status(201).json({ success: true, message: "Acara berjaya dicipta!", id_acara: result.insertId });
    } catch (error) {
        console.error("Ralat Cipta Acara:", error);
        res.status(500).json({ success: false, message: "Ralat semasa mencipta acara." });
    }
};

// B2. Senarai SEMUA acara (untuk admin) + jumlah peserta
export const senaraiSemuaAcara = async (req, res) => {
    try {
        const [acara] = await db.query(`
            SELECT 
                a.*,
                (SELECT COUNT(*) FROM penyertaan_acara p WHERE p.acara_id = a.id) AS jumlah_peserta
            FROM acara a
            ORDER BY a.created_at DESC
        `);
        res.status(200).json({ success: true, data: acara });
    } catch (error) {
        console.error("Ralat Senarai Semua Acara:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai acara." });
    }
};

// B3. Kemaskini acara (termasuk tukar status: AKTIF/TUTUP/SELESAI)
export const kemaskiniAcara = async (req, res) => {
    const { id } = req.params;
    const { 
        nama_acara, jenis_acara, keterangan, lokasi, 
        tarikh_acara, tarikh_tutup, emel_urusetia, no_tel_urusetia, status 
    } = req.body;

    try {
        const fields = [];
        const values = [];

        if (nama_acara !== undefined)      { fields.push('nama_acara = ?');      values.push(nama_acara); }
        if (jenis_acara !== undefined)     { fields.push('jenis_acara = ?');     values.push(jenis_acara || null); }
        if (keterangan !== undefined)      { fields.push('keterangan = ?');      values.push(keterangan || null); }
        if (lokasi !== undefined)          { fields.push('lokasi = ?');          values.push(lokasi || null); }
        if (tarikh_acara !== undefined)    { fields.push('tarikh_acara = ?');    values.push(tarikh_acara || null); }
        if (tarikh_tutup !== undefined)    { fields.push('tarikh_tutup = ?');    values.push(tarikh_tutup || null); }
        if (emel_urusetia !== undefined)   { fields.push('emel_urusetia = ?');   values.push(emel_urusetia || null); }
        if (no_tel_urusetia !== undefined) { fields.push('no_tel_urusetia = ?'); values.push(no_tel_urusetia || null); }
        if (status !== undefined)          { fields.push('status = ?');          values.push(status); }

        // Jika ada poster baru dimuat naik
        if (req.file) { fields.push('poster = ?'); values.push(req.file.filename); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: "Tiada maklumat untuk dikemas kini." });
        }

        values.push(id);
        await db.query(`UPDATE acara SET ${fields.join(', ')} WHERE id = ?`, values);

        res.status(200).json({ success: true, message: "Acara berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Acara:", error);
        res.status(500).json({ success: false, message: "Gagal mengemas kini acara." });
    }
};

// B4. Senarai peserta bagi satu acara
export const senaraiPesertaAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [peserta] = await db.query(`
            SELECT 
                p.id, p.kategori, p.catatan, p.tarikh_daftar,
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                u.emel AS email, u.phone AS no_tel, u.no_ahli,
                pt.nama_penempatan AS penempatan
            FROM penyertaan_acara p
            JOIN users u ON p.no_kp = u.no_kp
            LEFT JOIN penempatan pt ON u.penempatan_id = pt.id
            WHERE p.acara_id = ?
            ORDER BY p.tarikh_daftar ASC
        `, [id]);

        res.status(200).json({ success: true, count: peserta.length, data: peserta });
    } catch (error) {
        console.error("Ralat Senarai Peserta:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai peserta." });
    }
};

// B5. Padam acara (akan padam penyertaan juga melalui ON DELETE CASCADE)
export const padamAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [hasil] = await db.query(`DELETE FROM acara WHERE id = ?`, [id]);
        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });
        }
        res.status(200).json({ success: true, message: "Acara berjaya dipadam." });
    } catch (error) {
        console.error("Ralat Padam Acara:", error);
        res.status(500).json({ success: false, message: "Gagal memadam acara." });
    }
};