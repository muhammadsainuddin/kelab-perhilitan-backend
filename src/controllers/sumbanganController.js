import db from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { janaBilFPX, semakTransaksiBil } from '../utils/toyyibpay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '../public/uploads/images');

// ── Auto-migrasi jadual (CREATE IF NOT EXISTS — selamat untuk restart berulang) ──
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS kempen_sumbangan (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                no_kp_penerima VARCHAR(20) NOT NULL COLLATE utf8mb4_unicode_ci,
                tajuk        VARCHAR(255) NOT NULL,
                sebab        TEXT NOT NULL,
                no_akaun     VARCHAR(50) NOT NULL,
                nama_bank    VARCHAR(100) NOT NULL,
                qr_code      VARCHAR(255) NULL,
                amaun_sasaran DECIMAL(10,2) NULL,
                status       ENUM('AKTIF','TUTUP') NOT NULL DEFAULT 'AKTIF',
                tarikh_mula  DATE NOT NULL,
                tarikh_tamat DATE NULL,
                tarikh_cipta DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_penerima (no_kp_penerima),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS rekod_sumbangan (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                kempen_id        INT NOT NULL,
                no_kp_penyumbang VARCHAR(20) NULL COLLATE utf8mb4_unicode_ci,
                amaun            DECIMAL(10,2) NOT NULL,
                catatan          TEXT NULL,
                tarikh_rekod     DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_kempen (kempen_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS notifikasi (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                no_kp        VARCHAR(20) NOT NULL COLLATE utf8mb4_unicode_ci,
                jenis        VARCHAR(50) NOT NULL DEFAULT 'SISTEM',
                tajuk        VARCHAR(255) NOT NULL,
                mesej        TEXT NOT NULL,
                dibaca       TINYINT(1) NOT NULL DEFAULT 0,
                tarikh_cipta DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_no_kp  (no_kp),
                INDEX idx_dibaca (no_kp, dibaca)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Betulkan kolasi jadual yang mungkin sudah wujud dengan kolasi salah
        for (const tbl of ['kempen_sumbangan', 'rekod_sumbangan', 'notifikasi']) {
            await db.query(
                `ALTER TABLE ${tbl} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
            );
        }

        // Kolum allow_fpx pada kempen_sumbangan
        try {
            await db.query(`ALTER TABLE kempen_sumbangan ADD COLUMN allow_fpx TINYINT(1) NOT NULL DEFAULT 0`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error('[migrate] kempen_sumbangan.allow_fpx:', e.message);
        }

        // Jadual gambar sokongan kempen
        await db.query(`
            CREATE TABLE IF NOT EXISTS kempen_gambar (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                kempen_id  INT NOT NULL,
                filename   VARCHAR(255) NOT NULL,
                tarikh_muat DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_kempen_id (kempen_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Tambah kolum pada rekod_sumbangan (selamat — tangkap ER_DUP_FIELDNAME)
        for (const sql of [
            `ALTER TABLE rekod_sumbangan ADD COLUMN billcode VARCHAR(50) NULL`,
            `ALTER TABLE rekod_sumbangan ADD COLUMN kaedah ENUM('MANUAL','FPX') NOT NULL DEFAULT 'MANUAL'`,
            `ALTER TABLE rekod_sumbangan ADD COLUMN status_fpx ENUM('PENDING','BERJAYA','GAGAL') NULL`,
            // is_anon: sentiasa simpan no_kp; flag ini kawal paparan nama sahaja
            `ALTER TABLE rekod_sumbangan ADD COLUMN is_anon TINYINT(1) NOT NULL DEFAULT 0`,
            // Isi is_anon=1 untuk rekod lama yang no_kp_penyumbang NULL (selamat run berulang)
            `UPDATE rekod_sumbangan SET is_anon = 1 WHERE no_kp_penyumbang IS NULL AND is_anon = 0`
        ]) {
            try { await db.query(sql); } catch (e) {
                if (e.code !== 'ER_DUP_FIELDNAME') console.error('[migrate] rekod_sumbangan col:', e.message);
            }
        }
    } catch (e) {
        console.error('[migrate] kempen_sumbangan/rekod_sumbangan/notifikasi:', e.message);
    }
})();

const rm = (v) => 'RM ' + parseFloat(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ================================================================
// ADMIN
// ================================================================

// Cari ahli penerima — by nama (LIKE) atau no_kp tanpa dash
export const cariAhliPenerima = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.json({ success: true, data: [] });

        const noKpBersih = q.replace(/[-\s]/g, '');

        const [rows] = await db.query(`
            SELECT no_kp, nama_pegawai, no_akaun_bank, nama_bank
            FROM users
            WHERE nama_pegawai LIKE ?
               OR REPLACE(no_kp, '-', '') LIKE ?
            ORDER BY nama_pegawai
            LIMIT 10
        `, [`%${q}%`, `%${noKpBersih}%`]);

        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[sumbangan] cariAhliPenerima:', e);
        res.status(500).json({ success: false, data: [] });
    }
};

export const ciptaKempen = async (req, res) => {
    try {
        const { no_kp_penerima, tajuk, sebab, no_akaun, nama_bank, amaun_sasaran, tarikh_mula, tarikh_tamat, allow_fpx } = req.body;
        const qr_code = req.file ? req.file.filename : null;

        if (!no_kp_penerima || !tajuk || !sebab || !no_akaun || !nama_bank || !tarikh_mula) {
            return res.status(400).json({ success: false, message: 'Sila lengkapkan semua maklumat wajib.' });
        }

        const [ahli] = await db.query(`SELECT nama_pegawai FROM users WHERE no_kp = ?`, [no_kp_penerima]);
        if (!ahli.length) return res.status(400).json({ success: false, message: 'No. KP ahli tidak dijumpai dalam sistem.' });

        const [result] = await db.query(
            `INSERT INTO kempen_sumbangan
             (no_kp_penerima, tajuk, sebab, no_akaun, nama_bank, qr_code, amaun_sasaran, tarikh_mula, tarikh_tamat, allow_fpx)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [no_kp_penerima, tajuk, sebab, no_akaun, nama_bank, qr_code,
             amaun_sasaran || null, tarikh_mula, tarikh_tamat || null,
             allow_fpx === '1' || allow_fpx === true || allow_fpx === 1 ? 1 : 0]
        );
        const kempenId = result.insertId;

        // Beritahu penerima
        await db.query(
            `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej) VALUES (?,?,?,?)`,
            [no_kp_penerima, 'SISTEM', 'Kempen Sumbangan Dibuka Untuk Anda',
             `Pihak pentadbir telah membuka kempen sumbangan atas nama anda: "${tajuk}". Ahli kelab kini boleh melihat dan merekodkan sumbangan untuk anda.`]
        );

        res.json({ success: true, message: 'Kempen sumbangan berjaya dicipta.', id: kempenId });
    } catch (e) {
        console.error('[sumbangan] ciptaKempen:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const senaraiKempenAdmin = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT k.*,
                   u.nama_pegawai      AS nama_penerima,
                   pt.nama_penempatan  AS penempatan_penerima,
                   COUNT(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.id END)               AS jumlah_rekod,
                   COALESCE(SUM(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.amaun END), 0) AS jumlah_terkumpul,
                   GROUP_CONCAT(DISTINCT g.filename ORDER BY g.id ASC SEPARATOR ',') AS gambar_sokongan
            FROM kempen_sumbangan k
            LEFT JOIN users u           ON k.no_kp_penerima = u.no_kp
            LEFT JOIN penempatan pt     ON u.penempatan_id = pt.id
            LEFT JOIN rekod_sumbangan r ON r.kempen_id = k.id
            LEFT JOIN kempen_gambar g   ON g.kempen_id = k.id
            GROUP BY k.id
            ORDER BY k.tarikh_cipta DESC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[sumbangan] senaraiKempenAdmin:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const kemaskiniKempen = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, tajuk, sebab, no_akaun, nama_bank, amaun_sasaran, tarikh_tamat, allow_fpx } = req.body;
        const qr_code = req.file ? req.file.filename : undefined;

        const updates = [];
        const vals = [];

        if (status)    { updates.push('status = ?');    vals.push(status); }
        if (tajuk)     { updates.push('tajuk = ?');     vals.push(tajuk); }
        if (sebab)     { updates.push('sebab = ?');     vals.push(sebab); }
        if (no_akaun)  { updates.push('no_akaun = ?');  vals.push(no_akaun); }
        if (nama_bank) { updates.push('nama_bank = ?'); vals.push(nama_bank); }
        if (qr_code !== undefined) { updates.push('qr_code = ?'); vals.push(qr_code); }
        if (amaun_sasaran !== undefined) { updates.push('amaun_sasaran = ?'); vals.push(amaun_sasaran || null); }
        if (tarikh_tamat !== undefined)  { updates.push('tarikh_tamat = ?');  vals.push(tarikh_tamat || null); }
        if (allow_fpx !== undefined) {
            updates.push('allow_fpx = ?');
            vals.push(allow_fpx === '1' || allow_fpx === true || allow_fpx === 1 ? 1 : 0);
        }

        if (!updates.length) return res.status(400).json({ success: false, message: 'Tiada data untuk dikemaskini.' });

        vals.push(id);
        await db.query(`UPDATE kempen_sumbangan SET ${updates.join(', ')} WHERE id = ?`, vals);

        res.json({ success: true, message: 'Kempen berjaya dikemaskini.' });
    } catch (e) {
        console.error('[sumbangan] kemaskiniKempen:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const senaraiRekodKempen = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(`
            SELECT r.id, r.amaun, r.catatan, r.tarikh_rekod, r.kaedah, r.status_fpx, r.billcode, r.is_anon,
                   -- nama paparan: ahli lain nampak 'Anon' tapi admin nampak nama sebenar
                   CASE WHEN r.is_anon = 1 THEN 'Ahli Kelab (Anon)' ELSE u.nama_pegawai END AS nama_penyumbang,
                   -- nama sebenar untuk admin sahaja
                   u.nama_pegawai  AS nama_sebenar,
                   p.nama_penempatan AS penempatan_penyumbang
            FROM rekod_sumbangan r
            LEFT JOIN users u       ON r.no_kp_penyumbang = u.no_kp
            LEFT JOIN penempatan p  ON u.penempatan_id = p.id
            WHERE r.kempen_id = ?
              AND (r.kaedah = 'MANUAL' OR r.status_fpx IN ('BERJAYA','PENDING'))
            ORDER BY
              CASE WHEN r.kaedah = 'FPX' AND r.status_fpx = 'PENDING' THEN 1 ELSE 0 END ASC,
              r.tarikh_rekod DESC
        `, [id]);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[sumbangan] senaraiRekodKempen:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

// ================================================================
// AHLI (USER)
// ================================================================

export const senaraiKempenAktif = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT k.*,
                   u.nama_pegawai      AS nama_penerima,
                   pt.nama_penempatan  AS penempatan_penerima,
                   COUNT(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.id END)               AS jumlah_rekod,
                   COALESCE(SUM(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.amaun END), 0) AS jumlah_terkumpul,
                   GROUP_CONCAT(DISTINCT g.filename ORDER BY g.id ASC SEPARATOR ',') AS gambar_sokongan
            FROM kempen_sumbangan k
            LEFT JOIN users u           ON k.no_kp_penerima = u.no_kp
            LEFT JOIN penempatan pt     ON u.penempatan_id = pt.id
            LEFT JOIN rekod_sumbangan r ON r.kempen_id = k.id
            LEFT JOIN kempen_gambar g   ON g.kempen_id = k.id
            WHERE k.status = 'AKTIF'
              AND (k.tarikh_tamat IS NULL OR k.tarikh_tamat >= CURDATE())
            GROUP BY k.id
            ORDER BY k.tarikh_cipta DESC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[sumbangan] senaraiKempenAktif:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const rekodSumbangan = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const { kempen_id } = req.params;
        const { amaun, catatan, anon } = req.body;

        const nilaiAmaun = parseFloat(amaun);
        if (!amaun || isNaN(nilaiAmaun) || nilaiAmaun <= 0) {
            return res.status(400).json({ success: false, message: 'Amaun sumbangan tidak sah.' });
        }

        const [kempen] = await db.query(
            `SELECT * FROM kempen_sumbangan WHERE id = ? AND status = 'AKTIF'`, [kempen_id]
        );
        if (!kempen.length) return res.status(404).json({ success: false, message: 'Kempen tidak wujud atau telah ditutup.' });

        const isAnon = anon === true || anon === 'true' || anon === 1 || anon === '1';

        // Sentiasa simpan no_kp (admin boleh lihat); is_anon mengawal paparan kepada ahli lain
        await db.query(
            `INSERT INTO rekod_sumbangan (kempen_id, no_kp_penyumbang, amaun, catatan, kaedah, is_anon) VALUES (?,?,?,?,?,?)`,
            [kempen_id, no_kp, nilaiAmaun, catatan || null, 'MANUAL', isAnon ? 1 : 0]
        );

        const [donor] = await db.query(`SELECT nama_pegawai FROM users WHERE no_kp = ?`, [no_kp]);
        const namaPenyumbang = isAnon ? 'Seorang ahli kelab (Anon)' : (donor[0]?.nama_pegawai || 'Ahli Kelab');

        await db.query(
            `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej) VALUES (?,?,?,?)`,
            [kempen[0].no_kp_penerima, 'SUMBANGAN', 'Sumbangan Baharu Diterima',
             `${namaPenyumbang} telah merekodkan sumbangan ${rm(nilaiAmaun)} untuk kempen "${kempen[0].tajuk}".`]
        );

        res.json({ success: true, message: 'Sumbangan berjaya direkodkan. Terima kasih atas keprihatinan anda!' });
    } catch (e) {
        console.error('[sumbangan] rekodSumbangan:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

// Kempen di mana ahli ini adalah penerima (untuk paparan ahli penerima)
export const kempenSayaSebagaiPenerima = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const [rows] = await db.query(`
            SELECT k.id, k.tajuk, k.status, k.tarikh_mula, k.tarikh_tamat,
                   COUNT(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.id END)               AS jumlah_rekod,
                   COALESCE(SUM(CASE WHEN r.kaedah = 'MANUAL' OR r.status_fpx = 'BERJAYA' THEN r.amaun END), 0) AS jumlah_terkumpul,
                   COUNT(CASE WHEN r.kaedah = 'FPX' AND r.status_fpx = 'PENDING' THEN r.id END)                 AS jumlah_pending
            FROM kempen_sumbangan k
            LEFT JOIN rekod_sumbangan r ON r.kempen_id = k.id
            WHERE k.no_kp_penerima = ?
            GROUP BY k.id
            ORDER BY k.tarikh_cipta DESC
        `, [no_kp]);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const senaraiNotifikasi = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const [rows] = await db.query(
            `SELECT id, jenis, tajuk, mesej, dibaca, tarikh_cipta
             FROM notifikasi WHERE no_kp = ? ORDER BY tarikh_cipta DESC LIMIT 30`,
            [no_kp]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const tandaBacaNotifikasi = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        await db.query(`UPDATE notifikasi SET dibaca = 1 WHERE no_kp = ? AND dibaca = 0`, [no_kp]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const bilanganNotifikasiBelumBaca = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const [[row]] = await db.query(
            `SELECT COUNT(*) AS bilangan FROM notifikasi WHERE no_kp = ? AND dibaca = 0`,
            [no_kp]
        );
        res.json({ success: true, bilangan: parseInt(row.bilangan) });
    } catch (e) {
        res.status(200).json({ success: true, bilangan: 0 });
    }
};

// ================================================================
// GAMBAR SOKONGAN KEMPEN
// ================================================================

export const senaraiGambarKempen = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            `SELECT id, filename, tarikh_muat FROM kempen_gambar WHERE kempen_id = ? ORDER BY id ASC`,
            [id]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const tambahGambarKempen = async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.files || !req.files.length) {
            return res.status(400).json({ success: false, message: 'Tiada fail dimuat naik.' });
        }
        const values = req.files.map(f => [id, f.filename]);
        await db.query(`INSERT INTO kempen_gambar (kempen_id, filename) VALUES ?`, [values]);
        res.json({ success: true, message: `${req.files.length} gambar berjaya dimuat naik.` });
    } catch (e) {
        console.error('[sumbangan] tambahGambarKempen:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

export const hapusGambarKempen = async (req, res) => {
    try {
        const { id, gid } = req.params;
        const [[row]] = await db.query(
            `SELECT filename FROM kempen_gambar WHERE id = ? AND kempen_id = ?`, [gid, id]
        );
        if (!row) return res.status(404).json({ success: false, message: 'Gambar tidak dijumpai.' });

        await db.query(`DELETE FROM kempen_gambar WHERE id = ?`, [gid]);
        // Padam fail dari sistem
        const filePath = path.join(UPLOAD_DIR, row.filename);
        fs.unlink(filePath, () => {}); // senyap jika fail sudah tiada
        res.json({ success: true });
    } catch (e) {
        console.error('[sumbangan] hapusGambarKempen:', e);
        res.status(500).json({ success: false, message: 'Ralat sistem.' });
    }
};

// ================================================================
// FPX VIA TOYYIBPAY
// ================================================================

export const buatBilSumbanganFPX = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const { kempen_id } = req.params;
        const { amaun, catatan, anon } = req.body;

        const nilaiAmaun = parseFloat(amaun);
        if (!nilaiAmaun || isNaN(nilaiAmaun) || nilaiAmaun <= 0) {
            return res.status(400).json({ success: false, message: 'Amaun tidak sah.' });
        }

        const [kempen] = await db.query(
            `SELECT * FROM kempen_sumbangan WHERE id = ? AND status = 'AKTIF'`, [kempen_id]
        );
        if (!kempen.length) return res.status(404).json({ success: false, message: 'Kempen tidak wujud atau telah ditutup.' });
        if (!kempen[0].allow_fpx) return res.status(403).json({ success: false, message: 'Kempen ini tidak membenarkan bayaran FPX.' });

        const [userRows] = await db.query(`SELECT nama_pegawai, emel, phone FROM users WHERE no_kp = ?`, [no_kp]);
        if (!userRows.length) return res.status(401).json({ success: false, message: 'Pengguna tidak dijumpai.' });
        const user = userRows[0];

        const isAnon      = anon === true || anon === 'true' || anon === 1 || anon === '1';
        const totalBayar  = nilaiAmaun + 1; // +RM1 caj FPX
        const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5001';
        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

        // Ambil category code sumbangan dari tetapan DB
        let categoryCodeSumbangan = '';
        try {
            const [[katRow]] = await db.query(
                `SELECT nilai_teks FROM tetapan_sistem WHERE kunci = 'category_code_sumbangan'`
            );
            categoryCodeSumbangan = katRow?.nilai_teks || '';
        } catch (_) {}

        const { billCode, billUrl } = await janaBilFPX({
            keterangan: `Sumbangan: ${kempen[0].tajuk} (caj FPX RM1.00)`,
            amaun: totalBayar,
            returnUrl:           `${FRONTEND_URL}/#/dashboard/utama`,
            callbackUrl:         `${BACKEND_URL}/api/bayaran/callback-sumbangan`,
            referenceNo:         `SUMBANGAN-${kempen_id}-${Date.now()}`,
            user,
            jenis:               'SUMBANGAN',
            categoryCodeOverride: categoryCodeSumbangan || undefined
        });

        // Simpan rekod PENDING — sentiasa simpan no_kp; is_anon mengawal paparan sahaja
        await db.query(
            `INSERT INTO rekod_sumbangan (kempen_id, no_kp_penyumbang, amaun, catatan, billcode, kaedah, status_fpx, is_anon) VALUES (?,?,?,?,?,?,?,?)`,
            [kempen_id, no_kp, nilaiAmaun, catatan || null, billCode, 'FPX', 'PENDING', isAnon ? 1 : 0]
        );

        res.json({ success: true, billUrl });
    } catch (e) {
        console.error('[sumbangan] buatBilSumbanganFPX:', e);
        res.status(500).json({ success: false, message: e.message || 'Ralat sistem.' });
    }
};

// Callback awam — ToyyibPay hubungi ini selepas bayaran
export const callbackSumbanganFPX = async (req, res) => {
    try {
        const { billcode } = req.body;
        if (!billcode) return res.send('ok');

        const status = await semakTransaksiBil(billcode);

        if (status !== 'BERJAYA') {
            await db.query(
                `UPDATE rekod_sumbangan SET status_fpx = 'GAGAL' WHERE billcode = ? AND status_fpx = 'PENDING'`,
                [billcode]
            );
            return res.send('ok');
        }

        // Tarik rekod PENDING
        const [rekods] = await db.query(`
            SELECT r.*, k.no_kp_penerima, k.tajuk
            FROM rekod_sumbangan r
            JOIN kempen_sumbangan k ON r.kempen_id = k.id
            WHERE r.billcode = ? AND r.status_fpx = 'PENDING'
        `, [billcode]);

        if (!rekods.length) return res.send('ok');
        const r = rekods[0];

        await db.query(
            `UPDATE rekod_sumbangan SET status_fpx = 'BERJAYA' WHERE billcode = ?`, [billcode]
        );

        // Notifikasi kepada penerima
        let namaPenyumbang = 'Ahli Kelab (Anon)';
        if (!r.is_anon && r.no_kp_penyumbang) {
            const [[donor]] = await db.query(`SELECT nama_pegawai FROM users WHERE no_kp = ?`, [r.no_kp_penyumbang]);
            if (donor) namaPenyumbang = donor.nama_pegawai;
        }

        await db.query(
            `INSERT INTO notifikasi (no_kp, jenis, tajuk, mesej) VALUES (?,?,?,?)`,
            [r.no_kp_penerima, 'SUMBANGAN', 'Sumbangan FPX Berjaya Diterima',
             `${namaPenyumbang} telah menyumbang ${rm(r.amaun)} melalui FPX untuk kempen "${r.tajuk}".`]
        );

        res.send('ok');
    } catch (e) {
        console.error('[sumbangan] callbackSumbanganFPX:', e);
        res.send('ok');
    }
};
