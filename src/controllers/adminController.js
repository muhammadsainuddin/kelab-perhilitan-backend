import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import { janaNoAhliBaru } from '../utils/keahlianHelper.js';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';

// Auto-migrate: tambah kolum catatan_admin ke berhenti_ahli jika belum ada
(async () => {
    try {
        await db.query(`ALTER TABLE berhenti_ahli ADD COLUMN catatan_admin TEXT NULL`);
    } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.error('[migrate] berhenti_ahli.catatan_admin:', e.message);
    }
})();

// =====================================================================
// NOTA SELURUH FAIL:
// - Semua data ahli/staff diambil dari jadual `users` (bukan senarai_staff)
// - Kolum betul: emel, phone, gred_penyandang_sspa, penempatan_id (JOIN
//   penempatan), jenis_potongan, yuran_kelab_bulanan, status_ahli, no_ahli
// - status_ahli: ENUM('aktif','tidak aktif') -> HANYA suis login
// - "berbayar" dikira dinamik: Biro Angkasa = sentiasa; Manual = sejarah_bayaran
// =====================================================================


// ==========================================
// PROFIL 360: Tarik Profil Lengkap Ahli (Modular)
// ==========================================
export const getProfilAhliLengkap = async (req, res) => {
    const { no_kp } = req.params;

    try {
        const query = `
            SELECT 
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa, 
                p.nama_penempatan AS penempatan, u.penempatan_id,
                u.emel AS email, u.phone, u.saiz_baju, u.jenis_potongan, 
                u.yuran_kelab_bulanan, u.no_akaun_bank, u.nama_bank,
                u.nama_waris, u.no_phone_waris, u.akaun_bank_waris,
                u.nama_bank_waris, u.status_ahli, u.no_ahli,
                u.gambar, u.role
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui." });
        }

        let profil = rows[0];

        // Guna helper modular yang sama dengan ahli untuk semak status yuran
        const isPaid = await semakStatusBerbayar(no_kp, profil.jenis_potongan);

        profil.is_paid = isPaid;
        profil.status_yuran = isPaid ? 'AHLI BERBAYAR' : 'YURAN TERTUNGGAK';

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil Penuh Admin:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil lengkap." });
    }
};
// ==========================================
// 1. PENGURUSAN BANTUAN KEBAJIKAN
// ==========================================
// SQL MIGRATION (run once):
// ALTER TABLE bantuan_kebajikan
//   ADD COLUMN IF NOT EXISTS sebab_tolak TEXT DEFAULT NULL,
//   ADD COLUMN IF NOT EXISTS catatan_admin TEXT DEFAULT NULL,
//   ADD COLUMN IF NOT EXISTS diproses_oleh VARCHAR(20) DEFAULT NULL,
//   ADD COLUMN IF NOT EXISTS tarikh_dikemukakan DATETIME DEFAULT NULL,
//   ADD COLUMN IF NOT EXISTS tarikh_keputusan DATETIME DEFAULT NULL;

export const senaraiKebajikan = async (req, res) => {
    try {
        const query = `
            SELECT
                b.id, b.no_kp, u.nama_pegawai, u.no_ahli, u.gred_penyandang_sspa AS gred,
                p.nama_penempatan AS penempatan,
                b.jenis_bantuan, b.keterangan, b.dokumen_sokongan,
                b.status_permohonan, b.amaun_lulus, b.tarikh_mohon,
                b.sebab_tolak, b.catatan_admin, b.diproses_oleh,
                b.tarikh_dikemukakan, b.tarikh_keputusan
            FROM bantuan_kebajikan b
            JOIN users u ON b.no_kp = u.no_kp
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY
                CASE
                    WHEN b.status_permohonan IS NULL OR b.status_permohonan = 'DIPROSES' THEN 0
                    WHEN b.status_permohonan = 'DIKEMUKAKAN' THEN 1
                    ELSE 2
                END ASC,
                b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        console.error("Ralat Senarai Kebajikan:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniStatusKebajikan = async (req, res) => {
    const { id } = req.params;
    const { status_permohonan, amaun_lulus, sebab_tolak, catatan_admin } = req.body;
    const admin_no_kp = req.user?.no_kp || 'ADMIN';

    if (!status_permohonan) {
        return res.status(400).json({ success: false, message: 'Status permohonan wajib dihantar.' });
    }
    if (status_permohonan === 'DITOLAK' && !sebab_tolak?.trim()) {
        return res.status(400).json({ success: false, message: 'Sebab penolakan wajib dinyatakan.' });
    }
    if (status_permohonan === 'LULUS' && (!amaun_lulus || parseFloat(amaun_lulus) <= 0)) {
        return res.status(400).json({ success: false, message: 'Amaun lulus wajib diisi.' });
    }

    // Hanya Yang Dipertua boleh meluluskan permohonan
    if (status_permohonan === 'LULUS') {
        const [[admin]] = await db.query('SELECT jawatan_kelab FROM users WHERE no_kp = ?', [admin_no_kp]);
        if (!admin || admin.jawatan_kelab !== 'Yang Dipertua') {
            return res.status(403).json({ success: false, message: 'Hanya Yang Dipertua Kelab sahaja yang boleh meluluskan permohonan bantuan kebajikan.' });
        }
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const fields = ['status_permohonan = ?', 'diproses_oleh = ?'];
        const values = [status_permohonan, admin_no_kp];

        if (amaun_lulus !== undefined)    { fields.push('amaun_lulus = ?');       values.push(amaun_lulus || null); }
        if (sebab_tolak !== undefined)    { fields.push('sebab_tolak = ?');        values.push(sebab_tolak || null); }
        if (catatan_admin !== undefined)  { fields.push('catatan_admin = ?');      values.push(catatan_admin || null); }

        if (status_permohonan === 'DIKEMUKAKAN') {
            fields.push('tarikh_dikemukakan = NOW()');
        }
        if (status_permohonan === 'LULUS' || status_permohonan === 'DITOLAK') {
            fields.push('tarikh_keputusan = NOW()');
        }

        values.push(id);
        await conn.query(`UPDATE bantuan_kebajikan SET ${fields.join(', ')} WHERE id = ?`, values);

        // Jika LULUS, rekodkan ke buku tunai secara automatik
        if (status_permohonan === 'LULUS' && parseFloat(amaun_lulus) > 0) {
            const [[bantuan]] = await conn.query('SELECT no_kp, jenis_bantuan FROM bantuan_kebajikan WHERE id = ?', [id]);
            await conn.query(`
                INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, direkod_oleh)
                VALUES ('KELUAR', 'KEBAJIKAN', ?, ?, ?, ?, ?)
            `, [
                amaun_lulus,
                `BANTUAN-${id}`,
                `Sumbangan Kelab: ${bantuan.jenis_bantuan}`,
                bantuan.no_kp,
                admin_no_kp
            ]);
        }

        await conn.commit();

        const msg = {
            DIKEMUKAKAN: 'Permohonan berjaya dikemukakan kepada Jawatankuasa.',
            LULUS: 'Permohonan diluluskan dan direkod ke buku tunai.',
            DITOLAK: 'Permohonan telah ditolak.',
        };
        res.status(200).json({ success: true, message: msg[status_permohonan] || 'Berjaya dikemaskini.' });
    } catch (error) {
        await conn.rollback();
        console.error("Ralat kemaskini kebajikan:", error);
        res.status(500).json({ success: false, message: "Ralat pada pelayan. Gagal mengemaskini status." });
    } finally {
        conn.release();
    }
};

// ==========================================
// 2. PENGURUSAN PERMOHONAN BERHENTI AHLI
// ==========================================
export const senaraiBerhentiAhli = async (req, res) => {
    try {
        const query = `
            SELECT
                b.id, b.no_kp, u.nama_pegawai, u.no_ahli, u.gred_penyandang_sspa AS gred,
                p.nama_penempatan AS penempatan,
                b.sebab_berhenti, b.catatan_admin, b.status_permohonan, b.tarikh_mohon
            FROM berhenti_ahli b
            JOIN users u ON b.no_kp = u.no_kp
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        console.error("Ralat Senarai Berhenti:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniBerhentiAhli = async (req, res) => {
    const { id } = req.params;
    const { no_kp, status_permohonan, catatan_admin } = req.body;

    try {
        await db.query(
            `UPDATE berhenti_ahli SET status_permohonan = ?, catatan_admin = ? WHERE id = ?`,
            [status_permohonan, catatan_admin || null, id]
        );

        if (status_permohonan === 'LULUS') {
            await db.query(`UPDATE users SET status_ahli = 'tidak aktif' WHERE no_kp = ?`, [no_kp]);
        } else if (status_permohonan === 'DITOLAK') {
            await db.query(`UPDATE users SET status_ahli = 'aktif' WHERE no_kp = ?`, [no_kp]);
        }

        res.status(200).json({ success: true, message: `Permohonan berhenti telah ${status_permohonan}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. SENARAI & PENGURUSAN AHLI
// ==========================================

// Senarai semua pengguna + status berbayar dikira dinamik
export const senaraiSemuaAhli = async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const query = `
            SELECT
                u.id, u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                p.nama_penempatan AS penempatan, u.emel AS email, u.phone AS no_tel,
                u.jenis_potongan, u.yuran_kelab_bulanan, u.status_ahli, u.no_ahli, u.role,
                u.gambar, u.jawatan_kelab,
                CASE WHEN u.password IS NOT NULL AND u.password != '' THEN 1 ELSE 0 END AS has_daftar,
                CASE
                    WHEN u.jenis_potongan = 'Potongan Biro angkasa' THEN 1
                    WHEN EXISTS (
                        SELECT 1 FROM sejarah_bayaran sb
                        WHERE sb.no_kp = u.no_kp
                          AND sb.status = 'BERJAYA'
                          AND YEAR(sb.tarikh_cipta) = ?
                    ) THEN 1
                    ELSE 0
                END AS is_paid
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY u.nama_pegawai ASC
        `;
        const [ahli] = await db.query(query, [currentYear]);
        res.status(200).json({ success: true, data: ahli });
    } catch (error) {
        console.error("Ralat Senarai Ahli:", error);
        res.status(500).json({ success: false, message: "Gagal menarik senarai ahli." });
    }
};

// Kemaskini maklumat ahli (no_ahli, status login, role)
export const kemaskiniAhli = async (req, res) => {
    const { no_kp } = req.params;
    const { no_ahli, status_ahli, role, jawatan_kelab } = req.body;
    try {
        // Bina query dinamik supaya hanya field yang dihantar dikemas kini
        const fields = [];
        const values = [];

        if (no_ahli !== undefined)       { fields.push('no_ahli = ?');       values.push(no_ahli || null); }
        if (status_ahli !== undefined)   { fields.push('status_ahli = ?');   values.push(status_ahli); }
        if (role !== undefined)          { fields.push('role = ?');           values.push(role); }
        if (jawatan_kelab !== undefined) { fields.push('jawatan_kelab = ?'); values.push(jawatan_kelab || null); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: "Tiada maklumat untuk dikemas kini." });
        }

        values.push(no_kp);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE no_kp = ?`, values);

        res.status(200).json({ success: true, message: "Maklumat ahli berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Ahli:", error);
        res.status(500).json({ success: false, message: "Gagal mengemas kini ahli." });
    }
};

// Daftar ahli secara manual (untuk Biro Angkasa / pendaftaran admin)
// Jana no_ahli automatik jika belum ada.
export const daftarAhliManual = async (req, res) => {
    const { no_kp, yuran_bulanan, jenis_potongan } = req.body;
    try {
        const [wujud] = await db.query(`SELECT no_ahli FROM users WHERE no_kp = ?`, [no_kp]);
        if (wujud.length === 0) {
            return res.status(400).json({ success: false, message: "Kakitangan tiada dalam jadual users." });
        }

        // Jana no_ahli jika belum ada
        let noAhli = wujud[0].no_ahli;
        if (!noAhli || String(noAhli).trim() === '') {
            noAhli = await janaNoAhliBaru();
        }

        await db.query(
            `UPDATE users 
             SET yuran_kelab_bulanan = ?, jenis_potongan = ?, no_ahli = ?, status_ahli = 'aktif' 
             WHERE no_kp = ?`,
            [yuran_bulanan || null, jenis_potongan || 'Potongan Biro angkasa', noAhli, no_kp]
        );

        res.status(200).json({ success: true, message: "Ahli berjaya didaftarkan secara manual!", no_ahli: noAhli });
    } catch (error) {
        console.error("Ralat Daftar Manual:", error);
        res.status(500).json({ success: false, message: "Ralat pangkalan data." });
    }
};

// JANA no_ahli PUKAL untuk SEMUA ahli Biro Angkasa yang belum ada nombor.
// Running number berterusan. Jalankan sekali selepas import CSV.
export const janaNoAhliBiroPukal = async (req, res) => {
    try {
        const [senarai] = await db.query(`
            SELECT no_kp FROM users 
            WHERE jenis_potongan = 'Potongan Biro angkasa'
              AND (no_ahli IS NULL OR no_ahli = '')
            ORDER BY id ASC
        `);

        if (senarai.length === 0) {
            return res.status(200).json({ success: true, message: "Tiada ahli Biro Angkasa yang perlu dijana nombor.", dijana: 0 });
        }

        let dijana = 0;
        for (const ahli of senarai) {
            const noAhli = await janaNoAhliBaru(); // ambil MAX semasa + 1 setiap kali
            await db.query(`UPDATE users SET no_ahli = ? WHERE no_kp = ?`, [noAhli, ahli.no_kp]);
            dijana++;
        }

        res.status(200).json({ success: true, message: `${dijana} nombor ahli Biro Angkasa berjaya dijana.`, dijana });
    } catch (error) {
        console.error("Ralat Jana Pukal:", error);
        res.status(500).json({ success: false, message: "Gagal menjana nombor ahli pukal." });
    }
};

// Jana semula no_ahli untuk SEMUA ahli Biro Angkasa — format KP-XXXX/YYYY.
// Urutan: VU* → VK* → G14* → lain-lain, setiap kumpulan ikut id ASC.
export const janaSemulaNoBiroPukal = async (req, res) => {
    try {
        const tahun = new Date().getFullYear();
        const [senarai] = await db.query(`
            SELECT no_kp
            FROM users
            WHERE jenis_potongan = 'Potongan Biro angkasa'
            ORDER BY
                CASE
                    WHEN gred_penyandang_sspa LIKE 'VU%' THEN 0
                    WHEN gred_penyandang_sspa LIKE 'VK%' THEN 1
                    WHEN gred_penyandang_sspa LIKE 'G14%' THEN 2
                    ELSE 3
                END ASC,
                id ASC
        `);

        if (senarai.length === 0) {
            return res.status(200).json({ success: true, message: "Tiada ahli Biro Angkasa dalam sistem.", dijana: 0 });
        }

        for (let i = 0; i < senarai.length; i++) {
            const noAhli = `KP-${(i + 1).toString().padStart(4, '0')}/${tahun}`;
            await db.query(`UPDATE users SET no_ahli = ? WHERE no_kp = ?`, [noAhli, senarai[i].no_kp]);
        }

        res.status(200).json({
            success: true,
            message: `${senarai.length} nombor ahli Biro Angkasa berjaya dijana semula (VU → VK → G14 → lain).`,
            dijana: senarai.length,
        });
    } catch (error) {
        console.error("Ralat Jana Semula:", error);
        res.status(500).json({ success: false, message: "Gagal menjana semula nombor ahli." });
    }
};

// ==========================================
// 4. PENGURUSAN INDUK PENGGUNA (IMPORT CSV)
// ==========================================
export const senaraiSemuaStaff = async (req, res) => {
    try {
        const query = `
            SELECT 
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                p.nama_penempatan AS penempatan, u.status_ahli, u.no_ahli,
                u.jenis_potongan,
                CASE WHEN u.no_ahli IS NOT NULL AND u.no_ahli != '' THEN 1 ELSE 0 END AS is_ahli
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY u.nama_pegawai ASC
        `;
        const [staff] = await db.query(query);
        res.status(200).json({ success: true, data: staff });
    } catch (error) {
        console.error("Ralat Senarai Staff:", error);
        res.status(500).json({ success: false, message: "Gagal menarik senarai staff." });
    }
};

// Daftar kakitangan baharu secara pukal — INSERT/UPSERT + auto-aktif sebagai ahli.
export const tambahStaffBulk = async (req, res) => {
    const { staffList } = req.body;
    if (!staffList || staffList.length === 0) {
        return res.status(400).json({ success: false, message: "Tiada data dihantar." });
    }

    try {
        let berjaya = 0; const gagal = [];

        for (const s of staffList) {
            if (!s.no_kp || !s.nama_pegawai) { gagal.push(s.no_kp || '?'); continue; }

            // Resolve penempatan → penempatan_id
            let penempatanId = null;
            if (s.penempatan && String(s.penempatan).trim() !== '') {
                const namaPenempatan = String(s.penempatan).toUpperCase().trim();
                const [adaP] = await db.query(`SELECT id FROM penempatan WHERE nama_penempatan = ?`, [namaPenempatan]);
                if (adaP.length > 0) {
                    penempatanId = adaP[0].id;
                } else {
                    const [insP] = await db.query(`INSERT INTO penempatan (nama_penempatan) VALUES (?)`, [namaPenempatan]);
                    penempatanId = insP.insertId;
                }
            }

            const gred    = (s.gred_sspa || s.gred_penyandang_sspa || '').toUpperCase() || null;
            const jawatan = s.jawatan_kelab && s.jawatan_kelab !== '' ? s.jawatan_kelab : null;
            const nama    = (s.nama_pegawai || '').toUpperCase();

            await db.query(
                `INSERT INTO users (no_kp, nama_pegawai, gred_penyandang_sspa, penempatan_id,
                                    jawatan_kelab, jenis_potongan, status_ahli)
                 VALUES (?, ?, ?, ?, ?, 'Bayar secara manual', 'aktif')
                 ON DUPLICATE KEY UPDATE
                    nama_pegawai         = VALUES(nama_pegawai),
                    gred_penyandang_sspa = VALUES(gred_penyandang_sspa),
                    penempatan_id        = VALUES(penempatan_id),
                    jawatan_kelab        = COALESCE(VALUES(jawatan_kelab), jawatan_kelab),
                    status_ahli          = 'aktif'`,
                [s.no_kp, nama, gred, penempatanId, jawatan]
            );

            // Jana no_ahli jika belum ada
            const [[u]] = await db.query(`SELECT no_ahli FROM users WHERE no_kp = ?`, [s.no_kp]);
            if (!u.no_ahli || String(u.no_ahli).trim() === '') {
                const noAhli = await janaNoAhliBaru();
                await db.query(`UPDATE users SET no_ahli = ? WHERE no_kp = ?`, [noAhli, s.no_kp]);
            }

            berjaya++;
        }

        const msg = gagal.length > 0
            ? `${berjaya} berjaya, ${gagal.length} gagal (No. KP: ${gagal.join(', ')}).`
            : `${berjaya} rekod kakitangan berjaya didaftarkan.`;
        res.status(200).json({ success: true, message: msg, berjaya, gagal });
    } catch (error) {
        console.error("Ralat Daftar Pukal:", error);
        res.status(500).json({ success: false, message: "Ralat pangkalan data semasa daftar pukal." });
    }
};


// ==========================================
// 5. RESIT PEMBAYARAN KESELURUHAN (ADMIN)
// ==========================================
export const getAllResitBayaran = async (req, res) => {
    try {
        const query = `
            SELECT billCode, amaun, status, keterangan, 
                   DATE_FORMAT(tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh,
                   tarikh_cipta, nama_penuh, no_kp, email, no_tel, no_ahli
            FROM (
                SELECT 
                    sb.billCode, sb.amaun, sb.status, sb.keterangan, sb.tarikh_cipta,
                    u.nama_pegawai AS nama_penuh, u.no_kp, u.emel AS email, u.phone AS no_tel, u.no_ahli
                FROM sejarah_bayaran sb
                LEFT JOIN users u ON sb.no_kp = u.no_kp
                
                UNION ALL
                
                SELECT 
                    pk.billCode, pk.jumlah_keseluruhan AS amaun, 
                    CASE 
                        WHEN pk.status_pesanan IN ('DIBAYAR','DIPROSES','SELESAI') THEN 'BERJAYA'
                        WHEN pk.status_pesanan = 'DIBATALKAN' THEN 'GAGAL'
                        ELSE pk.status_pesanan 
                    END AS status, 
                    CONCAT('Pembelian Kedai (Pesanan #', pk.id, ')') AS keterangan, 
                    pk.tarikh_pesanan AS tarikh_cipta,
                    u.nama_pegawai AS nama_penuh, u.no_kp, u.emel AS email, u.phone AS no_tel, u.no_ahli
                FROM pesanan_kedai pk
                LEFT JOIN users u ON pk.no_kp = u.no_kp
                WHERE pk.billCode IS NOT NULL
            ) AS gabungan
            ORDER BY tarikh_cipta DESC
        `;
        const [rows] = await db.query(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Ralat Resit Bayaran:", error);
        res.status(500).json({ success: false, message: "Gagal menarik senarai resit gabungan." });
    }
};

// ==========================================
// 6. STATISTIK KEAHLIAN (BERBAYAR vs TIDAK)
// ==========================================
export const getStatistikTunggakan = async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();

        // Klausa "berbayar": Biro Angkasa ATAU ada bayaran BERJAYA tahun ini
        const paidExpr = `
            (u.jenis_potongan = 'Potongan Biro angkasa'
             OR EXISTS (
                SELECT 1 FROM sejarah_bayaran sb 
                WHERE sb.no_kp = u.no_kp AND sb.status = 'BERJAYA' 
                  AND YEAR(sb.tarikh_cipta) = ${db.escape(currentYear)}
             ))
        `;

        const getStats = async (isPaid) => {
            const whereClause = isPaid ? `WHERE ${paidExpr}` : `WHERE NOT ${paidExpr}`;

            const [kumpulan] = await db.query(`
                SELECT 
                    CASE 
                        WHEN u.gred_penyandang_sspa LIKE '%JUSA%' OR u.gred_penyandang_sspa LIKE '%VU%' OR u.gred_penyandang_sspa LIKE '%VK%' THEN 'JUSA / PENGURUSAN TERTINGGI'
                        WHEN u.gred_penyandang_sspa IS NULL OR u.gred_penyandang_sspa = '' THEN 'TIADA REKOD'
                        ELSE CONCAT('KUMPULAN ', SUBSTRING(u.gred_penyandang_sspa, 1, 1))
                    END AS label, COUNT(*) AS jumlah
                FROM users u ${whereClause} GROUP BY label ORDER BY jumlah DESC
            `);
            const [gred] = await db.query(`
                SELECT IFNULL(u.gred_penyandang_sspa, 'TIADA REKOD') AS label, COUNT(*) AS jumlah
                FROM users u ${whereClause} GROUP BY u.gred_penyandang_sspa ORDER BY jumlah DESC
            `);
            const [cawangan] = await db.query(`
                SELECT IFNULL(p.nama_penempatan, 'TIADA REKOD') AS label, COUNT(*) AS jumlah
                FROM users u LEFT JOIN penempatan p ON u.penempatan_id = p.id 
                ${whereClause} GROUP BY p.nama_penempatan ORDER BY jumlah DESC
            `);
            const [total] = await db.query(`SELECT COUNT(*) AS total FROM users u ${whereClause}`);

            return { total: total[0].total, kumpulan, gred, cawangan };
        };

        const berbayar = await getStats(true);
        const tidakBerbayar = await getStats(false);

        res.status(200).json({ 
            success: true, 
            data: { berbayar, tidak_berbayar: tidakBerbayar } 
        });
    } catch (error) {
        console.error("Ralat Statistik:", error);
        res.status(500).json({ success: false, message: "Gagal memuatkan statistik keahlian." });
    }
};

// ==========================================
// 7. DIREKTORI BERSEPADU
// ==========================================
export const getDirektoriBersepadu = async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const query = `
            SELECT 
                u.no_kp, u.nama_pegawai AS nama_penuh, u.gred_penyandang_sspa AS gred_sspa,
                p.nama_penempatan AS penempatan, u.emel AS email, u.phone AS no_tel,
                u.jenis_potongan, u.status_ahli, u.no_ahli,
                CASE 
                    WHEN u.jenis_potongan = 'Potongan Biro angkasa' THEN 'BERBAYAR (BIRO)'
                    WHEN EXISTS (
                        SELECT 1 FROM sejarah_bayaran sb 
                        WHERE sb.no_kp = u.no_kp AND sb.status = 'BERJAYA' 
                          AND YEAR(sb.tarikh_cipta) = ?
                    ) THEN 'BERBAYAR (FPX)'
                    ELSE 'BELUM BAYAR'
                END AS status_bayaran
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY u.nama_pegawai ASC
        `;
        const [rows] = await db.query(query, [currentYear]);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Ralat Direktori:", error);
        res.status(500).json({ success: false, message: "Gagal menarik senarai direktori." });
    }
};

// ==========================================
// 8. PROFIL ADMIN
// ==========================================
export const getProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp; 
    try {
        const query = `
            SELECT 
                u.nama_pegawai AS nama_penuh, u.no_kp,
                p.nama_penempatan AS nama_majikan, u.gred_penyandang_sspa AS gred_sspa,
                u.emel AS email, u.phone AS no_tel, u.saiz_baju, u.gambar,
                u.status_ahli, u.role, u.jawatan_kelab
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.no_kp = ?
        `;
        const [profil] = await db.query(query, [no_kp]);
        if (profil.length === 0) return res.status(404).json({ success: false, message: "Rekod tidak ditemui." });
        res.status(200).json({ success: true, data: profil[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { nama_penuh, email, no_tel, saiz_baju, gambar } = req.body;
    try {
        const query = `
            UPDATE users 
            SET nama_pegawai = IFNULL(?, nama_pegawai), 
                emel = IFNULL(?, emel), 
                phone = IFNULL(?, phone), 
                saiz_baju = IFNULL(?, saiz_baju), 
                gambar = IFNULL(?, gambar)
            WHERE no_kp = ?
        `;
        await db.query(query, [nama_penuh, email, no_tel, saiz_baju, gambar, no_kp]);
        res.status(200).json({ success: true, message: "Profil berjaya dikemas kini!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mengemas kini profil." });
    }
};

export const tukarKatalaluan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { kata_laluan_lama, kata_laluan_baru } = req.body;
    try {
        const [users] = await db.query(`SELECT password FROM users WHERE no_kp = ?`, [no_kp]);
        if (users.length === 0) return res.status(404).json({ success: false, message: "Akaun sistem tidak ditemui." });

        const isMatch = await bcrypt.compare(kata_laluan_lama, users[0].password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Kata laluan lama tidak sah." });

        if (!kata_laluan_baru || kata_laluan_baru.length < 8) {
            return res.status(400).json({ success: false, message: "Kata laluan baru mestilah sekurang-kurangnya 8 aksara." });
        }

        const hashed = await bcrypt.hash(kata_laluan_baru, 10);
        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashed, no_kp]);
        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pada pelayan." });
    }
};

// ==========================================
// 9. REKOD BELUM DAFTAR APPS
//    (Ada dalam users tapi tiada password — belum aktifkan akaun)
// ==========================================
export const getBelumDaftar = async (req, res) => {
    try {
        const query = `
            SELECT
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                p.nama_penempatan AS penempatan, u.emel AS email, u.phone AS no_tel,
                u.jenis_potongan, u.no_ahli, u.status_ahli
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.password IS NULL OR u.password = ''
            ORDER BY u.nama_pegawai ASC
        `;
        const [rows] = await db.query(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Ralat getBelumDaftar:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai belum daftar." });
    }
};

// ==========================================
// 10. KEMASKINI PROFIL PENUH AHLI (OLEH ADMIN)
// ==========================================
export const kemaskiniProfilAhli = async (req, res) => {
    const { no_kp } = req.params;
    const { nama_pegawai, email, no_tel, gred_sspa, penempatan, jenis_potongan, yuran_kelab_bulanan, saiz_baju } = req.body;

    try {
        // Cari / cipta penempatan_id jika penempatan diberikan
        let penempatanId = undefined;
        if (penempatan && String(penempatan).trim() !== '') {
            const nama = String(penempatan).toUpperCase().trim();
            const [ada] = await db.query('SELECT id FROM penempatan WHERE nama_penempatan = ?', [nama]);
            if (ada.length > 0) {
                penempatanId = ada[0].id;
            } else {
                const [ins] = await db.query('INSERT INTO penempatan (nama_penempatan) VALUES (?)', [nama]);
                penempatanId = ins.insertId;
            }
        }

        const fields = [];
        const values = [];

        if (nama_pegawai !== undefined)       { fields.push('nama_pegawai = ?');        values.push(String(nama_pegawai).toUpperCase().trim()); }
        if (email !== undefined)              { fields.push('emel = ?');                values.push(email || null); }
        if (no_tel !== undefined)             { fields.push('phone = ?');               values.push(no_tel || null); }
        if (gred_sspa !== undefined)          { fields.push('gred_penyandang_sspa = ?');values.push(gred_sspa || null); }
        if (penempatanId !== undefined)       { fields.push('penempatan_id = ?');       values.push(penempatanId); }
        if (jenis_potongan !== undefined)     { fields.push('jenis_potongan = ?');      values.push(jenis_potongan || null); }
        if (yuran_kelab_bulanan !== undefined){ fields.push('yuran_kelab_bulanan = ?'); values.push(parseFloat(yuran_kelab_bulanan) || 0); }
        if (saiz_baju !== undefined)          { fields.push('saiz_baju = ?');           values.push(saiz_baju || null); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: "Tiada maklumat untuk dikemas kini." });
        }

        values.push(no_kp);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE no_kp = ?`, values);
        res.status(200).json({ success: true, message: "Profil ahli berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat kemaskiniProfilAhli:", error);
        res.status(500).json({ success: false, message: "Gagal mengemaskini profil ahli." });
    }
};

export const getAcaraAhli = async (req, res) => {
    try {
        const { no_kp } = req.params;
        const [rows] = await db.query(`
            SELECT a.nama_acara, a.jenis_acara, p.kategori, p.catatan, 
                   DATE_FORMAT(a.tarikh_acara, '%d-%m-%Y') AS tarikh_acara,
                   DATE_FORMAT(p.tarikh_daftar, '%d-%m-%Y') AS tarikh_daftar
            FROM penyertaan_acara p
            JOIN acara a ON p.acara_id = a.id
            WHERE p.no_kp = ?
            ORDER BY a.tarikh_acara DESC
        `, [no_kp]);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik rekod acara." });
    }
};