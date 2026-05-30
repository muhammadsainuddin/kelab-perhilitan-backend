import db from '../config/db.js';
import bcrypt from 'bcryptjs';

// ==========================================
// 1. PENGURUSAN BANTUAN & BERHENTI
// ==========================================
export const senaraiKebajikan = async (req, res) => {
    try {
        const query = `
            SELECT b.id, b.no_kp, s.nama_pegawai, s.penempatan, b.jenis_bantuan, 
                   b.keterangan, b.dokumen_sokongan, b.status_permohonan, b.tarikh_mohon
            FROM bantuan_kebajikan b
            JOIN senarai_staff s ON b.no_kp = s.no_kp
            ORDER BY b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniStatusKebajikan = async (req, res) => {
    const { id } = req.params;
    const { status_permohonan } = req.body;
    try {
        await db.query(`UPDATE bantuan_kebajikan SET status_permohonan = ? WHERE id = ?`, [status_permohonan, id]);
        res.status(200).json({ success: true, message: `Status dikemas kini kepada: ${status_permohonan}` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const senaraiBerhentiAhli = async (req, res) => {
    try {
        const query = `
            SELECT b.id, b.no_kp, s.nama_pegawai, s.penempatan, b.sebab_berhenti, 
                   b.status_permohonan, b.tarikh_mohon
            FROM berhenti_ahli b
            JOIN senarai_staff s ON b.no_kp = s.no_kp
            ORDER BY b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniBerhentiAhli = async (req, res) => {
    const { id } = req.params;
    const { no_kp, status_permohonan } = req.body;

    try {
        await db.query(`UPDATE berhenti_ahli SET status_permohonan = ? WHERE id = ?`, [status_permohonan, id]);
        
        if (status_permohonan === 'LULUS') {
            await db.query(`UPDATE senarai_staff SET status_ahli = 'TIDAK AKTIF / BERHENTI' WHERE no_kp = ?`, [no_kp]);
            await db.query(`UPDATE users SET status_akaun = 'Tidak Aktif' WHERE no_kp = ?`, [no_kp]);
        } else if (status_permohonan === 'DITOLAK') {
            await db.query(`UPDATE senarai_staff SET status_ahli = 'A - Aktif' WHERE no_kp = ?`, [no_kp]);
        }
        
        res.status(200).json({ success: true, message: `Permohonan penamatan kelab telah ${status_permohonan}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 2. SENARAI PENGESAHAN & AHLI
// ==========================================
export const senaraiMenungguSahkan = async (req, res) => {
    try {
        const query = `
            SELECT 
                no_kp, emel_kelab AS email, nama_pegawai, gred_sspa, penempatan, 
                negeri_bertugas, no_tel, yuran_bulanan, pilihan_potongan, 
                klasifikasi_jawatan, created_at AS tarikh_mohon
            FROM senarai_staff
            WHERE status_ahli = 'Menunggu Kelulusan'
            ORDER BY created_at ASC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, count: senarai.length, data: senarai });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik data pengesahan." });
    }
};

export const sahkanAkaun = async (req, res) => {
    const { no_kp } = req.params;
    const status_keputusan = req.body.status_keputusan || req.body.status_ahli;

    try {
        if (status_keputusan === 'Aktif' || status_keputusan === 'A - Aktif') {
            const [ahli] = await db.query('SELECT created_at FROM senarai_staff WHERE no_kp = ?', [no_kp]);
            if (ahli.length === 0) return res.status(404).json({ success: false, message: "Rekod tidak dijumpai." });

            let tahun = new Date().getFullYear();
            if (ahli[0].created_at) {
                const tarikhDaftar = new Date(ahli[0].created_at);
                if (!isNaN(tarikhDaftar)) tahun = tarikhDaftar.getFullYear();
            }

            const pattern = `KP-%-${tahun}`;
            const [lastRecord] = await db.query('SELECT no_ahli FROM senarai_staff WHERE no_ahli LIKE ? ORDER BY no_ahli DESC LIMIT 1', [pattern]);

            let nextNum = 1;
            if (lastRecord.length > 0 && lastRecord[0].no_ahli) {
                try {
                    const parts = lastRecord[0].no_ahli.split('-'); 
                    if (parts.length >= 3) nextNum = parseInt(parts[1], 10) + 1;
                } catch (err) { nextNum = 1; }
            }

            const noAhliBaru = `KP-${nextNum.toString().padStart(4, '0')}-${tahun}`;

            await db.query('UPDATE senarai_staff SET status_ahli = "A - Aktif", no_ahli = ? WHERE no_kp = ?', [noAhliBaru, no_kp]);
            await db.query('UPDATE users SET status_akaun = "Aktif" WHERE no_kp = ?', [no_kp]);
            
            return res.status(200).json({ success: true, message: "Akaun diaktifkan.", no_ahli: noAhliBaru });
        } else {
            await db.query('UPDATE senarai_staff SET status_ahli = "Ditolak" WHERE no_kp = ?', [no_kp]);
            await db.query('UPDATE users SET status_akaun = "Ditolak" WHERE no_kp = ?', [no_kp]);
            return res.status(200).json({ success: true, message: "Permohonan telah ditolak." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const senaraiSemuaAhli = async (req, res) => {
    try {
        const query = `
            SELECT s.*, u.role, u.status_akaun
            FROM senarai_staff s
            LEFT JOIN users u ON s.no_kp = u.no_kp
            ORDER BY s.nama_pegawai ASC
        `;
        const [ahli] = await db.query(query);
        res.status(200).json({ success: true, data: ahli });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik senarai ahli." });
    }
};

export const kemaskiniAhli = async (req, res) => {
    const { no_kp } = req.params;
    const { no_ahli, status_ahli, role } = req.body;
    try {
        await db.query(`UPDATE senarai_staff SET no_ahli = ?, status_ahli = ? WHERE no_kp = ?`, [no_ahli || null, status_ahli, no_kp]);
        if (role) {
            const statusAkaun = status_ahli === 'A - Aktif' ? 'Aktif' : 'Ditolak';
            await db.query(`UPDATE users SET role = ?, status_akaun = ? WHERE no_kp = ?`, [role, statusAkaun, no_kp]);
        }
        res.status(200).json({ success: true, message: "Maklumat ahli berjaya dikemas kini." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mengemas kini ahli." });
    }
};

export const daftarAhliManual = async (req, res) => {
    const { no_kp, yuran_bulanan, pilihan_potongan, no_ahli } = req.body;
    try {
        const [wujud] = await db.query(`SELECT status_ahli FROM senarai_staff WHERE no_kp = ?`, [no_kp]);
        if (wujud.length === 0) return res.status(400).json({ success: false, message: "Kakitangan tiada dalam senarai Induk." });
        
        await db.query(
            `UPDATE senarai_staff SET yuran_bulanan = ?, pilihan_potongan = ?, no_ahli = ?, status_ahli = 'A - Aktif' WHERE no_kp = ?`, 
            [yuran_bulanan, pilihan_potongan, no_ahli || null, no_kp]
        );
        res.status(200).json({ success: true, message: "Ahli baharu berjaya didaftarkan secara manual!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pangkalan data." });
    }
};

// ==========================================
// 3. PENGURUSAN STAFF, STATISTIK & DIREKTORI
// ==========================================
export const senaraiSemuaStaff = async (req, res) => {
    try {
        const query = `
            SELECT no_kp, nama_pegawai, gred_sspa, penempatan, status_ahli,
            CASE WHEN status_ahli = 'A - Aktif' THEN 1 ELSE 0 END AS is_ahli
            FROM senarai_staff ORDER BY nama_pegawai ASC
        `;
        const [staff] = await db.query(query);
        res.status(200).json({ success: true, data: staff });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik senarai staff." });
    }
};

export const tambahStaffBulk = async (req, res) => {
    const { staffList } = req.body;
    if (!staffList || staffList.length === 0) return res.status(400).json({ success: false, message: "Tiada data dihantar." });
    
    try {
        const values = staffList.map(s => [s.no_kp, s.nama_pegawai.toUpperCase(), s.gred_sspa.toUpperCase(), s.penempatan.toUpperCase()]);
        const query = `
            INSERT INTO senarai_staff (no_kp, nama_pegawai, gred_sspa, penempatan) VALUES ? 
            ON DUPLICATE KEY UPDATE 
            nama_pegawai = VALUES(nama_pegawai), gred_sspa = VALUES(gred_sspa), penempatan = VALUES(penempatan)
        `;
        await db.query(query, [values]);
        res.status(200).json({ success: true, message: `${staffList.length} rekod penjawat berjaya disimpan.` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pangkalan data." });
    }
};

export const getAllResitBayaran = async (req, res) => {
    try {
        const query = `
            SELECT 
                sb.id, sb.billCode, sb.amaun, sb.status, sb.keterangan, 
                DATE_FORMAT(sb.tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh,
                sb.tarikh_cipta, s.nama_pegawai AS nama_penuh, s.no_kp, s.emel_kelab AS email, s.no_tel, s.no_ahli
            FROM sejarah_bayaran sb
            LEFT JOIN senarai_staff s ON sb.no_kp = s.no_kp
            ORDER BY sb.tarikh_cipta DESC
        `;
        const [rows] = await db.query(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik senarai resit." });
    }
};

export const getDirektoriBersepadu = async (req, res) => {
    try {
        const query = `SELECT *, nama_pegawai AS nama_penuh, emel_kelab AS email FROM senarai_staff ORDER BY nama_pegawai ASC`;
        const [rows] = await db.query(query);
        
        const formattedData = rows.map(row => ({
            ...row,
            status_sebenar: row.status_ahli || 'BELUM MENDAFTAR',
            potongan_sebenar: row.pilihan_potongan || 'TIADA'
        }));

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik senarai direktori." });
    }
};

export const getStatistikTunggakan = async (req, res) => {
    try {
        const baseJoin = ``; // Tidak perlu join, terus query dari senarai_staff
        const unpaidWhere = `WHERE status_ahli IS NULL OR status_ahli != 'A - Aktif'`;
        const paidWhere = `WHERE status_ahli = 'A - Aktif'`;

        const getStats = async (whereClause) => {
            const [kumpulan] = await db.query(`
                SELECT 
                    CASE 
                        WHEN gred_sspa LIKE '%JUSA%' OR gred_sspa LIKE '%VU%' OR gred_sspa LIKE '%VK%' THEN 'JUSA / PENGURUSAN TERTINGGI'
                        WHEN gred_sspa IS NULL OR gred_sspa = '' THEN 'TIADA REKOD'
                        ELSE CONCAT('KUMPULAN ', SUBSTRING(gred_sspa, 1, 1))
                    END as label, COUNT(*) as jumlah
                FROM senarai_staff ${whereClause} GROUP BY label ORDER BY jumlah DESC
            `);
            const [gred] = await db.query(`
                SELECT IFNULL(gred_sspa, 'TIADA REKOD') as label, COUNT(*) as jumlah
                FROM senarai_staff ${whereClause} GROUP BY gred_sspa ORDER BY jumlah DESC
            `);
            const [cawangan] = await db.query(`
                SELECT IFNULL(penempatan, 'TIADA REKOD') as label, COUNT(*) as jumlah
                FROM senarai_staff ${whereClause} GROUP BY penempatan ORDER BY jumlah DESC
            `);
            const [total] = await db.query(`SELECT COUNT(*) as total FROM senarai_staff ${whereClause}`);
            
            return { total: total[0].total, kumpulan, gred, cawangan };
        };

        const tidakBerbayar = await getStats(unpaidWhere);
        const berbayar = await getStats(paidWhere);

        res.status(200).json({ success: true, data: { tidak_berbayar: tidakBerbayar, berbayar: berbayar } });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal memuatkan statistik keahlian." });
    }
};

// ==========================================
// 4. PROFIL ADMIN
// ==========================================
export const getProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp; 
    try {
        const query = `SELECT nama_pegawai AS nama_penuh, no_kp, penempatan AS nama_majikan, gred_sspa, emel_kelab AS email, no_tel, saiz_baju, gambar, status_ahli FROM senarai_staff WHERE no_kp = ?`;
        const [profil] = await db.query(query, [no_kp]);
        if (profil.length === 0) return res.status(404).json({ success: false, message: "Rekod tidak ditemui." });
        res.status(200).json({ success: true, data: profil[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { nama_penuh, email, no_tel, saiz_baju, nama_majikan, gambar } = req.body;
    try {
        const query = `
            UPDATE senarai_staff 
            SET nama_pegawai = ?, penempatan = ?, emel_kelab = ?, no_tel = ?, saiz_baju = ?, gambar = ? 
            WHERE no_kp = ?
        `;
        await db.query(query, [nama_penuh, nama_majikan, email, no_tel, saiz_baju, gambar, no_kp]);
        
        if (email) await db.query(`UPDATE users SET email = ? WHERE no_kp = ?`, [email, no_kp]);

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