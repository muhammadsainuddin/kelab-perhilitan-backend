import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import { janaNoAhliBaru } from '../utils/keahlianHelper.js';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';

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
export const senaraiKebajikan = async (req, res) => {
    try {
        const query = `
            SELECT 
                b.id, b.no_kp, u.nama_pegawai, p.nama_penempatan AS penempatan,
                b.jenis_bantuan, b.keterangan, b.dokumen_sokongan, 
                b.status_permohonan, b.amaun_lulus, b.tarikh_mohon
            FROM bantuan_kebajikan b
            JOIN users u ON b.no_kp = u.no_kp
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ORDER BY b.tarikh_mohon DESC
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
    const { status_permohonan, amaun_lulus } = req.body;
    const admin_id = req.user?.no_kp || 'ADMIN'; // ID Admin yang merekodkan

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Kemaskini status dan amaun lulus
        await conn.query(
            `UPDATE bantuan_kebajikan SET status_permohonan = ?, amaun_lulus = ? WHERE id = ?`, 
            [status_permohonan, amaun_lulus || null, id]
        );

        // Jika LULUS, automatik rekodkan ke BUKU TUNAI (transaksi_kewangan)
        if (status_permohonan === 'LULUS' && amaun_lulus > 0) {
            // Dapatkan maklumat pemohon untuk direkodkan
            const [[bantuan]] = await conn.query('SELECT no_kp, jenis_bantuan FROM bantuan_kebajikan WHERE id = ?', [id]);

            await conn.query(`
                INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, direkod_oleh)
                VALUES ('KELUAR', 'KEBAJIKAN', ?, ?, ?, ?, ?)
            `, [
                amaun_lulus,
                `BANTUAN-${id}`, // Rujukan
                `Sumbangan Kelab: ${bantuan.jenis_bantuan}`, // Nota
                bantuan.no_kp, // Ahli yang menerima
                admin_id // Admin yang meluluskan
            ]);
        }

        await conn.commit();
        res.status(200).json({ success: true, message: `Permohonan telah diluluskan dan direkod ke buku tunai.` });
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
                b.id, b.no_kp, u.nama_pegawai, p.nama_penempatan AS penempatan,
                b.sebab_berhenti, b.status_permohonan, b.tarikh_mohon
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
    const { no_kp, status_permohonan } = req.body;

    try {
        await db.query(`UPDATE berhenti_ahli SET status_permohonan = ? WHERE id = ?`, [status_permohonan, id]);

        // Jika LULUS -> nonaktifkan login ahli (status_ahli = 'tidak aktif')
        if (status_permohonan === 'LULUS') {
            await db.query(`UPDATE users SET status_ahli = 'tidak aktif' WHERE no_kp = ?`, [no_kp]);
        }
        // Jika DITOLAK -> kekalkan login aktif (tiada perubahan diperlukan,
        // status_ahli sepatutnya masih 'aktif')
        else if (status_permohonan === 'DITOLAK') {
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
    const { no_ahli, status_ahli, role } = req.body;
    try {
        // Bina query dinamik supaya hanya field yang dihantar dikemas kini
        const fields = [];
        const values = [];

        if (no_ahli !== undefined) { fields.push('no_ahli = ?'); values.push(no_ahli || null); }
        if (status_ahli !== undefined) { fields.push('status_ahli = ?'); values.push(status_ahli); }
        if (role !== undefined) { fields.push('role = ?'); values.push(role); }

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

// Import pukal kakitangan ke jadual users.
// Penempatan dipetakan melalui jadual penempatan (cari/cipta id).
export const tambahStaffBulk = async (req, res) => {
    const { staffList } = req.body;
    if (!staffList || staffList.length === 0) {
        return res.status(400).json({ success: false, message: "Tiada data dihantar." });
    }

    try {
        for (const s of staffList) {
            // Pastikan penempatan wujud, dapatkan id-nya
            let penempatanId = null;
            if (s.penempatan && String(s.penempatan).trim() !== '') {
                const namaPenempatan = String(s.penempatan).toUpperCase().trim();
                const [adaP] = await db.query(
                    `SELECT id FROM penempatan WHERE nama_penempatan = ?`, [namaPenempatan]
                );
                if (adaP.length > 0) {
                    penempatanId = adaP[0].id;
                } else {
                    const [insP] = await db.query(
                        `INSERT INTO penempatan (nama_penempatan) VALUES (?)`, [namaPenempatan]
                    );
                    penempatanId = insP.insertId;
                }
            }

            // Upsert pengguna berdasarkan no_kp (UNIQUE)
            await db.query(
                `INSERT INTO users (no_kp, nama_pegawai, gred_penyandang_sspa, penempatan_id) 
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                    nama_pegawai = VALUES(nama_pegawai),
                    gred_penyandang_sspa = VALUES(gred_penyandang_sspa),
                    penempatan_id = VALUES(penempatan_id)`,
                [
                    s.no_kp,
                    (s.nama_pegawai || '').toUpperCase(),
                    (s.gred_sspa || s.gred_penyandang_sspa || '').toUpperCase(),
                    penempatanId
                ]
            );
        }

        res.status(200).json({ success: true, message: `${staffList.length} rekod kakitangan berjaya disimpan.` });
    } catch (error) {
        console.error("Ralat Import Pukal:", error);
        res.status(500).json({ success: false, message: "Ralat pangkalan data semasa import." });
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
                u.status_ahli, u.role
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

        const hashed = await bcrypt.hash(kata_laluan_baru, 10);
        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashed, no_kp]);
        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pada pelayan." });
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