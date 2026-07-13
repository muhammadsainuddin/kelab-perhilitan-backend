import db from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Migration: jadual sumbangan luar + tuntutan MAKSWIP ───────────────────────
(async () => {
    try {
        // Jadual rekod sumbangan individu dari syarikat (BUKAN ledger utama)
        await db.query(`
            CREATE TABLE IF NOT EXISTS kutipan_sumbangan_luar (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                nama_acara    VARCHAR(200) NOT NULL DEFAULT 'Umum',
                nama_syarikat VARCHAR(200) NOT NULL,
                amaun         DECIMAL(10,2) NOT NULL,
                tarikh        DATE NOT NULL,
                nota          TEXT NULL,
                id_tuntutan   INT NULL,
                direkod_oleh  VARCHAR(20) NULL,
                tarikh_rekod  DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_acara (nama_acara),
                INDEX idx_tuntutan (id_tuntutan)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Jadual rekod tuntutan ke MAKSWIP (jumlah bersih sahaja masuk ledger)
        await db.query(`
            CREATE TABLE IF NOT EXISTS tuntutan_makswip (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                nama_acara       VARCHAR(200) NOT NULL,
                jumlah_kasar     DECIMAL(10,2) NOT NULL,
                potongan         DECIMAL(10,2) NOT NULL,
                jumlah_bersih    DECIMAL(10,2) NOT NULL,
                tarikh_tuntutan  DATE NOT NULL,
                nota             TEXT NULL,
                id_transaksi     INT NULL,
                direkod_oleh     VARCHAR(20) NULL,
                tarikh_rekod     DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Jadual acara khas (Sakom dll.) — mini-ledger atas lejar utama
        await db.query(`
            CREATE TABLE IF NOT EXISTS acara_khas (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                nama         VARCHAR(200) NOT NULL,
                deskripsi    TEXT NULL,
                status       ENUM('AKTIF','SELESAI') NOT NULL DEFAULT 'AKTIF',
                tarikh_mula  DATE NULL,
                tarikh_tamat DATE NULL,
                tarikh_cipta DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Flag jadual migrasi (lari sekali sahaja)
        await db.query(`
            CREATE TABLE IF NOT EXISTS _migrasi (
                kunci   VARCHAR(100) PRIMARY KEY,
                tarikh  DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Migrasi satu-kali: tambah lajur acara_khas_id ke transaksi_kewangan
        const [[migAcara]] = await db.query(
            `SELECT kunci FROM _migrasi WHERE kunci = 'v2_acara_khas_id'`
        );
        if (!migAcara) {
            await db.query(`
                ALTER TABLE transaksi_kewangan
                ADD COLUMN acara_khas_id INT NULL DEFAULT NULL,
                ADD INDEX idx_acara_khas (acara_khas_id)
            `);
            await db.query(`INSERT INTO _migrasi (kunci) VALUES ('v2_acara_khas_id')`);
            console.log('[Migration] v2_acara_khas_id: lajur acara_khas_id ditambah ke transaksi_kewangan.');
        }

        // Jadual pakej sumbangan per acara khas (Gangsa, Utama, dll.)
        await db.query(`
            CREATE TABLE IF NOT EXISTS pakej_sumbangan (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                acara_khas_id INT NOT NULL,
                nama          VARCHAR(200) NOT NULL,
                amaun_pakej   DECIMAL(10,2) NULL,
                status        ENUM('AKTIF','TUTUP') NOT NULL DEFAULT 'AKTIF',
                tarikh_cipta  DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pakej_acara (acara_khas_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Migrasi satu-kali: tambah lajur acara_khas_id + pakej_id + pic ke kutipan_sumbangan_luar
        const [[migSumbangan]] = await db.query(
            `SELECT kunci FROM _migrasi WHERE kunci = 'v3_sumbangan_acara_khas'`
        );
        if (!migSumbangan) {
            await db.query(`
                ALTER TABLE kutipan_sumbangan_luar
                ADD COLUMN acara_khas_id INT NULL DEFAULT NULL,
                ADD COLUMN pakej_id INT NULL DEFAULT NULL,
                ADD COLUMN pic_no_kp VARCHAR(20) NULL DEFAULT NULL,
                ADD INDEX idx_sumbangan_acara (acara_khas_id),
                ADD INDEX idx_sumbangan_pakej (pakej_id)
            `);
            await db.query(`INSERT INTO _migrasi (kunci) VALUES ('v3_sumbangan_acara_khas')`);
            console.log('[Migration] v3_sumbangan_acara_khas: lajur acara_khas_id/pakej_id/pic_no_kp ditambah.');
        }

        // Migrasi v4: tambah fail_dokumen + acara_khas_id ke tuntutan_makswip
        const [[migTuntutan]] = await db.query(
            `SELECT kunci FROM _migrasi WHERE kunci = 'v4_tuntutan_fail_dokumen'`
        );
        if (!migTuntutan) {
            await db.query(`ALTER TABLE tuntutan_makswip
                ADD COLUMN fail_dokumen VARCHAR(500) NULL DEFAULT NULL,
                ADD COLUMN acara_khas_id INT NULL DEFAULT NULL,
                ADD INDEX idx_tuntutan_acara (acara_khas_id)`);
            await db.query(`INSERT INTO _migrasi (kunci) VALUES ('v4_tuntutan_fail_dokumen')`);
            console.log('[Migration] v4_tuntutan_fail_dokumen: lajur fail_dokumen + acara_khas_id ditambah ke tuntutan_makswip.');
        }

        // Migrasi v4b: pastikan acara_khas_id wujud (v4 mungkin berlari sebelum lajur ini ditambah)
        const [[colAcaraKhasId]] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tuntutan_makswip'
            AND COLUMN_NAME = 'acara_khas_id'
        `);
        if (!colAcaraKhasId) {
            await db.query(`ALTER TABLE tuntutan_makswip
                ADD COLUMN acara_khas_id INT NULL DEFAULT NULL,
                ADD INDEX idx_tuntutan_acara (acara_khas_id)`);
            console.log('[Migration] v4b: lajur acara_khas_id ditambah ke tuntutan_makswip.');
        }

        // Migrasi v4c: pastikan fail_dokumen wujud
        const [[colFailDok]] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tuntutan_makswip'
            AND COLUMN_NAME = 'fail_dokumen'
        `);
        if (!colFailDok) {
            await db.query(`ALTER TABLE tuntutan_makswip
                ADD COLUMN fail_dokumen VARCHAR(500) NULL DEFAULT NULL`);
            console.log('[Migration] v4c: lajur fail_dokumen ditambah ke tuntutan_makswip.');
        }

        // Migrasi v5: tambah nilai 'ACARA_KHAS' ke ENUM kategori dalam transaksi_kewangan
        const [[colKategori]] = await db.query(`
            SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaksi_kewangan'
            AND COLUMN_NAME = 'kategori'
        `);
        if (colKategori && !colKategori.COLUMN_TYPE.includes('ACARA_KHAS')) {
            await db.query(`
                ALTER TABLE transaksi_kewangan
                MODIFY COLUMN kategori ENUM(
                    'YURAN','KEDAI','KEBAJIKAN','SUMBANGAN','OPERASI',
                    'BELIAN_BARANG','PERKHIDMATAN','ACARA','ACARA_KHAS','LAIN-LAIN'
                ) NULL
            `);
            console.log('[Migration] v5: ACARA_KHAS ditambah ke ENUM kategori transaksi_kewangan.');
        }

        // Migrasi v6: tambah fail_dokumen ke transaksi_kewangan
        const [[colFailDokKew]] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaksi_kewangan'
            AND COLUMN_NAME = 'fail_dokumen'
        `);
        if (!colFailDokKew) {
            await db.query(`ALTER TABLE transaksi_kewangan ADD COLUMN fail_dokumen JSON NULL DEFAULT NULL`);
            console.log('[Migration] v6: lajur fail_dokumen ditambah ke transaksi_kewangan.');
        }

        // Migrasi v7: jadual audit log edit transaksi
        await db.query(`
            CREATE TABLE IF NOT EXISTS log_edit_transaksi (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                transaksi_id INT NOT NULL,
                diedit_oleh  VARCHAR(20) NULL,
                tarikh_edit  DATETIME DEFAULT CURRENT_TIMESTAMP,
                sebelum      JSON NULL,
                selepas      JSON NULL,
                INDEX idx_log_transaksi (transaksi_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Migrasi satu-kali: pindahkan SUMBANGAN dari transaksi_kewangan ke kutipan_sumbangan_luar
        const [[sudahMigrasi]] = await db.query(
            `SELECT kunci FROM _migrasi WHERE kunci = 'v1_sumbangan_ke_luar'`
        );
        if (!sudahMigrasi) {
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                // Salin ke jadual baru
                await conn.query(`
                    INSERT INTO kutipan_sumbangan_luar
                        (nama_acara, nama_syarikat, amaun, tarikh, nota, direkod_oleh, tarikh_rekod)
                    SELECT
                        COALESCE(NULLIF(TRIM(rujukan), ''), 'Umum') AS nama_acara,
                        COALESCE(NULLIF(TRIM(penerima_bayaran), ''), 'Tidak Diketahui') AS nama_syarikat,
                        amaun,
                        COALESCE(DATE(tarikh_transaksi), CURDATE()) AS tarikh,
                        nota,
                        direkod_oleh,
                        tarikh_transaksi AS tarikh_rekod
                    FROM transaksi_kewangan
                    WHERE jenis_aliran = 'MASUK' AND kategori = 'SUMBANGAN'
                `);
                // Padam dari ledger utama
                await conn.query(
                    `DELETE FROM transaksi_kewangan WHERE jenis_aliran = 'MASUK' AND kategori = 'SUMBANGAN'`
                );
                // Tandakan selesai
                await conn.query(`INSERT INTO _migrasi (kunci) VALUES ('v1_sumbangan_ke_luar')`);
                await conn.commit();
                console.log('[Migration] v1_sumbangan_ke_luar: data sumbangan dipindahkan ke kutipan_sumbangan_luar.');
            } catch (e) {
                await conn.rollback();
                console.error('[Migration] v1_sumbangan_ke_luar gagal:', e.message);
            } finally {
                conn.release();
            }
        }
    } catch (e) {
        console.error('[Migration] kewangan sumbangan:', e.message);
    }
})();

// ==========================================
// 1. STATISTIK DASHBOARD KEWANGAN
//    GET /api/admin/kewangan/statistik?tahun=2025
// ==========================================
export const getStatistikKewangan = async (req, res) => {
    const tahun = req.query.tahun || new Date().getFullYear();

    try {
        const [summary] = await db.query(`
            SELECT
                COALESCE(SUM(CASE WHEN jenis_aliran = 'MASUK'  THEN amaun END), 0) AS jumlah_masuk,
                COALESCE(SUM(CASE WHEN jenis_aliran = 'KELUAR' THEN amaun END), 0) AS jumlah_keluar
            FROM transaksi_kewangan
            WHERE YEAR(tarikh_transaksi) = ?
        `, [tahun]);

        const baki = parseFloat(summary[0].jumlah_masuk) - parseFloat(summary[0].jumlah_keluar);

        const [byKategori] = await db.query(`
            SELECT kategori, SUM(amaun) AS jumlah
            FROM transaksi_kewangan
            WHERE jenis_aliran = 'MASUK' AND YEAR(tarikh_transaksi) = ?
            GROUP BY kategori
        `, [tahun]);

        const [bulanan] = await db.query(`
            SELECT
                MONTH(tarikh_transaksi) AS bulan,
                COALESCE(SUM(CASE WHEN jenis_aliran = 'MASUK'  THEN amaun END), 0) AS masuk,
                COALESCE(SUM(CASE WHEN jenis_aliran = 'KELUAR' THEN amaun END), 0) AS keluar
            FROM transaksi_kewangan
            WHERE YEAR(tarikh_transaksi) = ?
            GROUP BY MONTH(tarikh_transaksi)
            ORDER BY bulan ASC
        `, [tahun]);

        const dataBulanan = Array.from({ length: 12 }, (_, i) => {
            const found = bulanan.find(b => b.bulan === i + 1);
            return {
                bulan: i + 1,
                masuk:  found ? parseFloat(found.masuk)  : 0,
                keluar: found ? parseFloat(found.keluar) : 0,
            };
        });

        return res.status(200).json({
            success: true,
            data: {
                jumlah_masuk:  parseFloat(summary[0].jumlah_masuk),
                jumlah_keluar: parseFloat(summary[0].jumlah_keluar),
                baki,
                by_kategori: byKategori,
                bulanan: dataBulanan,
                tahun: parseInt(tahun),
            },
        });

    } catch (error) {
        console.error('[KEWANGAN] Gagal tarik statistik:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik statistik kewangan.' });
    }
};

// ==========================================
// 2. SENARAI TRANSAKSI (Buku Tunai)
//    GET /api/admin/kewangan/transaksi
// ==========================================
export const getSenaraiTransaksi = async (req, res) => {
    const { jenis, kategori, cari, tahun, bulan, page = 1, limit = 20, acara_khas_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        let conditions = [];
        let params = [];

        if (tahun)         { conditions.push('YEAR(t.tarikh_transaksi) = ?');  params.push(parseInt(tahun)); }
        if (bulan)         { conditions.push('MONTH(t.tarikh_transaksi) = ?'); params.push(parseInt(bulan)); }
        if (jenis)         { conditions.push('t.jenis_aliran = ?'); params.push(jenis); }
        if (kategori)      { conditions.push('t.kategori = ?');     params.push(kategori); }
        if (acara_khas_id) { conditions.push('t.acara_khas_id = ?'); params.push(parseInt(acara_khas_id)); }
        if (cari) {
            conditions.push('(t.rujukan LIKE ? OR t.nota LIKE ? OR t.penerima_bayaran LIKE ? OR u.nama_pegawai LIKE ?)');
            params.push(`%${cari}%`, `%${cari}%`, `%${cari}%`, `%${cari}%`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const [rows] = await db.query(`
            SELECT
                t.id, t.jenis_aliran, t.kategori, t.amaun,
                t.rujukan, t.nota, t.penerima_bayaran, t.acara_khas_id,
                t.fail_dokumen, t.direkod_oleh,
                a.nama AS nama_acara_khas,
                u.nama_pegawai AS nama_ahli,
                dr.nama_pegawai AS nama_direkod_oleh,
                DATE_FORMAT(t.tarikh_transaksi, '%d-%m-%Y %H:%i') AS tarikh
            FROM transaksi_kewangan t
            LEFT JOIN users u
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            LEFT JOIN users dr
                ON CONVERT(t.direkod_oleh USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(dr.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            LEFT JOIN acara_khas a ON t.acara_khas_id = a.id
            ${where}
            ORDER BY t.tarikh_transaksi DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM transaksi_kewangan t LEFT JOIN users u ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci LEFT JOIN acara_khas a ON t.acara_khas_id = a.id ${where}`,
            params
        );

        return res.status(200).json({
            success: true,
            data: rows,
            meta: { total, page: parseInt(page), limit: parseInt(limit) },
        });

    } catch (error) {
        console.error('[KEWANGAN] Gagal tarik transaksi:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai transaksi.' });
    }
};

// ==========================================
// 3. REKOD KELUAR MANUAL
//    POST /api/admin/kewangan/keluar
// ==========================================
export const rekodKeluar = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { kategori, amaun, nota, rujukan, no_kp_pihak, penerima_bayaran } = req.body;

    if (!kategori || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi kategori dan amaun yang sah.' });
    }

    let kpPenerima = null;
    let namaPenerima = null;

    if (kategori === 'KEBAJIKAN') {
        kpPenerima = no_kp_pihak;
    } else {
        namaPenerima = penerima_bayaran;
    }

    try {
        await db.query(`
            INSERT INTO transaksi_kewangan
                (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, penerima_bayaran, direkod_oleh)
            VALUES ('KELUAR', ?, ?, ?, ?, ?, ?, ?)
        `, [kategori, parseFloat(amaun), rujukan || null, nota || null, kpPenerima, namaPenerima, no_kp_admin]);

        return res.status(201).json({ success: true, message: 'Rekod perbelanjaan berjaya disimpan.' });

    } catch (error) {
        console.error('[KEWANGAN] Gagal rekod keluar:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan rekod.' });
    }
};

// ==========================================
// 5. PENYATA KEWANGAN TAHUNAN
//    GET /api/admin/kewangan/penyata-tahunan?tahun=2025
//    Pendapatan & perbelanjaan dipecah ikut kategori + baki.
// ==========================================
export const getPenyataTahunan = async (req, res) => {
    const tahun = req.query.tahun || new Date().getFullYear();

    try {
        // Pecahan ikut kategori (kedua-dua aliran)
        const [pecahan] = await db.query(`
            SELECT jenis_aliran, kategori,
                   SUM(amaun) AS jumlah, COUNT(*) AS bil
            FROM transaksi_kewangan
            WHERE YEAR(tarikh_transaksi) = ?
            GROUP BY jenis_aliran, kategori
            ORDER BY jenis_aliran, jumlah DESC
        `, [tahun]);

        const pendapatan = pecahan
            .filter(r => r.jenis_aliran === 'MASUK')
            .map(r => ({ kategori: r.kategori, jumlah: parseFloat(r.jumlah), bil: r.bil }));
        const perbelanjaan = pecahan
            .filter(r => r.jenis_aliran === 'KELUAR')
            .map(r => ({ kategori: r.kategori, jumlah: parseFloat(r.jumlah), bil: r.bil }));

        const jumlahPendapatan  = pendapatan.reduce((a, b) => a + b.jumlah, 0);
        const jumlahPerbelanjaan = perbelanjaan.reduce((a, b) => a + b.jumlah, 0);

        // Baki bawa ke hadapan (semua tahun sebelum tahun dipilih)
        const [[bawaResult]] = await db.query(`
            SELECT
                COALESCE(SUM(CASE WHEN jenis_aliran='MASUK'  THEN amaun END),0) -
                COALESCE(SUM(CASE WHEN jenis_aliran='KELUAR' THEN amaun END),0) AS baki_bawa
            FROM transaksi_kewangan
            WHERE YEAR(tarikh_transaksi) < ?
        `, [tahun]);
        const bakiBawa = parseFloat(bawaResult.baki_bawa) || 0;

        return res.status(200).json({
            success: true,
            data: {
                tahun: parseInt(tahun),
                pendapatan, perbelanjaan,
                jumlah_pendapatan: jumlahPendapatan,
                jumlah_perbelanjaan: jumlahPerbelanjaan,
                lebihan_kurangan: jumlahPendapatan - jumlahPerbelanjaan,
                baki_bawa: bakiBawa,
                baki_akhir: bakiBawa + jumlahPendapatan - jumlahPerbelanjaan,
            },
        });
    } catch (error) {
        console.error('[KEWANGAN] Gagal tarik penyata tahunan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik penyata tahunan.' });
    }
};

// ==========================================
// 6. SUMBANGAN LUAR — SENARAI KUTIPAN (dikumpul mengikut acara)
//    GET /api/admin/kewangan/sumbangan
// ==========================================
export const getSenaraiSumbangan = async (req, res) => {
    try {
        // Semua rekod individu
        const [rekod] = await db.query(`
            SELECT k.id, k.nama_acara, k.nama_syarikat, k.amaun,
                   DATE_FORMAT(k.tarikh, '%d-%m-%Y') AS tarikh, k.nota, k.id_tuntutan,
                   k.acara_khas_id, a.nama AS nama_acara_khas,
                   k.pakej_id, p.nama AS nama_pakej,
                   k.pic_no_kp, u.nama_pegawai AS nama_pic,
                   k.direkod_oleh, dr.nama_pegawai AS nama_direkod_oleh
            FROM kutipan_sumbangan_luar k
            LEFT JOIN acara_khas a ON k.acara_khas_id = a.id
            LEFT JOIN pakej_sumbangan p ON k.pakej_id = p.id
            LEFT JOIN users u ON CONVERT(k.pic_no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
                               = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            LEFT JOIN users dr ON CONVERT(k.direkod_oleh USING utf8mb4) COLLATE utf8mb4_unicode_ci
                                = CONVERT(dr.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            ORDER BY k.tarikh DESC, k.id DESC
        `);

        // Ringkasan per acara — status dituntut berdasarkan sama ada semua rekod sudah ditag
        const [acara] = await db.query(`
            SELECT
                nama_acara,
                COUNT(id)                                                  AS bil_penyumbang,
                SUM(amaun)                                                 AS jumlah_kasar,
                COUNT(CASE WHEN id_tuntutan IS NULL THEN 1 END)            AS bil_belum_dituntut,
                COALESCE(SUM(CASE WHEN id_tuntutan IS NULL THEN amaun END), 0) AS amaun_belum_dituntut
            FROM kutipan_sumbangan_luar
            GROUP BY nama_acara
            ORDER BY MAX(tarikh) DESC
        `);

        // Sejarah tuntutan bulk
        const [sejarahTuntutan] = await db.query(`
            SELECT t.id, t.nama_acara, t.jumlah_kasar, t.potongan, t.jumlah_bersih,
                   DATE_FORMAT(t.tarikh_tuntutan, '%d-%m-%Y') AS tarikh_tuntutan,
                   t.nota, t.fail_dokumen, t.tarikh_rekod, t.acara_khas_id,
                   a.nama AS nama_acara_khas,
                   t.direkod_oleh, dr.nama_pegawai AS nama_direkod_oleh
            FROM tuntutan_makswip t
            LEFT JOIN acara_khas a ON a.id = t.acara_khas_id
            LEFT JOIN users dr ON CONVERT(t.direkod_oleh USING utf8mb4) COLLATE utf8mb4_unicode_ci
                                = CONVERT(dr.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            ORDER BY t.tarikh_tuntutan DESC, t.id DESC
        `);

        // Jumlah keseluruhan
        const jumlahKasar      = rekod.reduce((s, r) => s + parseFloat(r.amaun), 0);
        const jumlahBelumTuntut = rekod.filter(r => !r.id_tuntutan).reduce((s, r) => s + parseFloat(r.amaun), 0);
        const [[{ jd }]]       = await db.query(`SELECT COALESCE(SUM(jumlah_bersih),0) AS jd FROM tuntutan_makswip`);

        return res.status(200).json({
            success: true,
            acara,
            rekod,
            sejarah_tuntutan:  sejarahTuntutan,
            jumlah:            jumlahKasar,
            jumlah_kasar:      jumlahKasar,
            jumlah_belum_tuntut: jumlahBelumTuntut,
            jumlah_diterima:   parseFloat(jd),
        });
    } catch (error) {
        console.error('[KEWANGAN] Gagal tarik sumbangan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai sumbangan.' });
    }
};

// ==========================================
// 6b. SUMBANGAN — KEMASKINI
//     PUT /api/admin/kewangan/sumbangan/:id
// ==========================================
export const kemaskiniSumbangan = async (req, res) => {
    const { id } = req.params;
    const { nama_syarikat, amaun, tarikh, nota, acara_khas_id, pakej_id, pic_no_kp } = req.body;

    const [[rekod]] = await db.query(`SELECT id FROM kutipan_sumbangan_luar WHERE id = ?`, [id]);
    if (!rekod) return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });

    const syarikat = (nama_syarikat || '').trim();
    if (!syarikat || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Nama syarikat dan amaun wajib diisi.' });
    }

    const acaraId = acara_khas_id ? parseInt(acara_khas_id) : null;
    const pakejId = pakej_id ? parseInt(pakej_id) : null;
    const picKp   = pic_no_kp ? pic_no_kp.toString().trim() : null;

    // Dapatkan nama acara dari acara_khas jika id diberikan
    let namaAcara = 'Umum';
    if (acaraId) {
        const [[acaraRekod]] = await db.query('SELECT nama FROM acara_khas WHERE id = ?', [acaraId]);
        namaAcara = acaraRekod?.nama || 'Umum';
    }

    try {
        await db.query(`
            UPDATE kutipan_sumbangan_luar
            SET nama_syarikat = ?, nama_acara = ?, amaun = ?, tarikh = ?, nota = ?,
                acara_khas_id = ?, pakej_id = ?, pic_no_kp = ?
            WHERE id = ?
        `, [syarikat, namaAcara, parseFloat(amaun), tarikh || null, nota || null,
            acaraId, pakejId, picKp, id]);
        return res.status(200).json({ success: true, message: 'Rekod sumbangan berjaya dikemaskini.' });
    } catch (e) {
        console.error('[KEWANGAN] Gagal kemaskini sumbangan:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini rekod.' });
    }
};

// ==========================================
// 6c. SUMBANGAN — PADAM
//     DELETE /api/admin/kewangan/sumbangan/:id
// ==========================================
export const padamSumbangan = async (req, res) => {
    const { id } = req.params;

    const [[rekod]] = await db.query(`SELECT id, id_tuntutan FROM kutipan_sumbangan_luar WHERE id = ?`, [id]);
    if (!rekod) return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });
    if (rekod.id_tuntutan) {
        return res.status(400).json({ success: false, message: 'Rekod ini sudah dituntut melalui MAKSWIP dan tidak boleh dipadam.' });
    }

    try {
        await db.query(`DELETE FROM kutipan_sumbangan_luar WHERE id = ?`, [id]);
        return res.status(200).json({ success: true, message: 'Rekod sumbangan berjaya dipadam.' });
    } catch (e) {
        console.error('[KEWANGAN] Gagal padam sumbangan:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat memadam rekod.' });
    }
};

// ==========================================
// 7. SUMBANGAN LUAR — REKOD SATU
//    POST /api/admin/kewangan/sumbangan
//    Body: { nama_syarikat, amaun, nama_acara, tarikh?, nota? }
//    (nama_penyumbang & program diterima juga untuk keserasian CSV lama)
// ==========================================
export const rekodSumbangan = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { nama_penyumbang, nama_syarikat, amaun, program, nama_acara, nota, tarikh,
            acara_khas_id, pakej_id, pic_no_kp } = req.body;

    const syarikat = (nama_syarikat || nama_penyumbang || '').toString().trim();
    const acaraId  = acara_khas_id ? parseInt(acara_khas_id) : null;
    const pakejId  = pakej_id ? parseInt(pakej_id) : null;
    const picKp    = pic_no_kp ? pic_no_kp.toString().trim() : null;

    // Dapatkan nama acara dari acara_khas jika id diberikan
    let acara = (nama_acara || program || '').toString().trim();
    if (acaraId && !acara) {
        const [[acaraRekod]] = await db.query('SELECT nama FROM acara_khas WHERE id = ?', [acaraId]);
        acara = acaraRekod?.nama || 'Umum';
    } else if (!acara) {
        acara = 'Umum';
    }

    if (!syarikat || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi nama syarikat/penyumbang dan amaun yang sah.' });
    }

    try {
        await db.query(`
            INSERT INTO kutipan_sumbangan_luar
                (nama_acara, nama_syarikat, amaun, tarikh, nota, direkod_oleh, acara_khas_id, pakej_id, pic_no_kp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            acara, syarikat, parseFloat(amaun),
            tarikh ? new Date(tarikh) : new Date(),
            nota || null, no_kp_admin, acaraId, pakejId, picKp,
        ]);
        return res.status(201).json({ success: true, message: 'Sumbangan berjaya direkodkan.' });
    } catch (error) {
        console.error('[KEWANGAN] Gagal rekod sumbangan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan sumbangan.' });
    }
};

// ==========================================
// 8. SUMBANGAN LUAR — IMPORT PUKAL
//    POST /api/admin/kewangan/sumbangan/import
//    Body: { senarai: [{ nama_penyumbang/nama_syarikat, amaun, program/nama_acara, tarikh? }] }
// ==========================================
export const importSumbanganBulk = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { senarai } = req.body;

    if (!Array.isArray(senarai) || senarai.length === 0) {
        return res.status(400).json({ success: false, message: 'Tiada data sumbangan dihantar.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        let berjaya = 0;
        const dilangkau = [];

        for (let i = 0; i < senarai.length; i++) {
            const s = senarai[i];
            const syarikat = ((s.nama_syarikat || s.nama_penyumbang) || '').toString().trim();
            const acara    = ((s.nama_acara || s.program) || 'Umum').toString().trim();
            const amaun    = parseFloat(s.amaun);
            if (!syarikat || !amaun || amaun <= 0) { dilangkau.push(i + 1); continue; }
            await conn.query(`
                INSERT INTO kutipan_sumbangan_luar
                    (nama_acara, nama_syarikat, amaun, tarikh, nota, direkod_oleh)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                acara, syarikat, amaun,
                s.tarikh ? new Date(s.tarikh) : new Date(),
                s.nota || null, no_kp_admin,
            ]);
            berjaya++;
        }

        await conn.commit();
        return res.status(201).json({
            success: true,
            message: `${berjaya} sumbangan berjaya diimport.` + (dilangkau.length ? ` ${dilangkau.length} baris dilangkau.` : ''),
            berjaya, dilangkau,
        });
    } catch (error) {
        await conn.rollback();
        console.error('[KEWANGAN] Gagal import sumbangan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat semasa import sumbangan.' });
    } finally {
        conn.release();
    }
};

// ==========================================
// 8b. TUNTUTAN MAKSWIP
//     POST /api/admin/kewangan/tuntutan-makswip  (multipart/form-data)
//     Body: { tarikh_tuntutan, jumlah_bersih, nota?, ids_sumbangan (JSON array) }
//     File: fail_dokumen (PDF / imej, pilihan)
// ==========================================
export const rekodTuntutanMakswip = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { acara_khas_id, tarikh_tuntutan, jumlah_bersih, nota } = req.body;

    if (!acara_khas_id) {
        return res.status(400).json({ success: false, message: 'Sila pilih acara khas.' });
    }
    if (!tarikh_tuntutan) {
        return res.status(400).json({ success: false, message: 'Tarikh tuntutan wajib diisi.' });
    }
    const jumlahBersih = parseFloat(jumlah_bersih);
    if (!jumlahBersih || jumlahBersih <= 0) {
        return res.status(400).json({ success: false, message: 'Jumlah bersih diterima wajib diisi.' });
    }

    const failDokumen = req.file ? `/uploads/tuntutan/${req.file.filename}` : null;

    // Dapatkan nama dan jumlah kasar sumbangan untuk acara ini (rujukan sahaja)
    const [[acara]]      = await db.query(`SELECT nama FROM acara_khas WHERE id = ?`, [acara_khas_id]);
    const [[{ kasar, bil }]] = await db.query(
        `SELECT COALESCE(SUM(amaun), 0) AS kasar, COUNT(*) AS bil FROM kutipan_sumbangan_luar WHERE acara_khas_id = ?`,
        [acara_khas_id]
    );

    if (!acara) {
        return res.status(400).json({ success: false, message: 'Acara khas tidak dijumpai.' });
    }

    const jumlahKasar = parseFloat(parseFloat(kasar).toFixed(2));
    const potongan    = parseFloat(Math.max(0, jumlahKasar - jumlahBersih).toFixed(2));
    const namaAcara   = acara.nama;
    const notaLedger  = `Tuntutan MAKSWIP — ${namaAcara}. Sumbangan dikutip: RM ${jumlahKasar.toFixed(2)} (${bil} penyumbang). Bersih diterima: RM ${jumlahBersih.toFixed(2)}.${nota ? ` ${nota}` : ''}`;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [tResult] = await conn.query(`
            INSERT INTO tuntutan_makswip
                (nama_acara, jumlah_kasar, potongan, jumlah_bersih, tarikh_tuntutan, nota, fail_dokumen, acara_khas_id, direkod_oleh)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [namaAcara, jumlahKasar, potongan, jumlahBersih, tarikh_tuntutan, nota || null, failDokumen, acara_khas_id, no_kp_admin]);

        const tuntutanId = tResult.insertId;

        const [trResult] = await conn.query(`
            INSERT INTO transaksi_kewangan
                (jenis_aliran, kategori, amaun, rujukan, nota, penerima_bayaran, direkod_oleh, tarikh_transaksi, acara_khas_id)
            VALUES ('MASUK', 'SUMBANGAN', ?, ?, ?, 'MAKSWIP', ?, ?, ?)
        `, [jumlahBersih, `TUNTUTAN-MAKSWIP-${tuntutanId}`, notaLedger, no_kp_admin, tarikh_tuntutan, acara_khas_id]);

        await conn.query(`UPDATE tuntutan_makswip SET id_transaksi = ? WHERE id = ?`, [trResult.insertId, tuntutanId]);

        await conn.commit();
        return res.status(201).json({
            success: true,
            message: `Tuntutan MAKSWIP berjaya. RM ${jumlahBersih.toFixed(2)} dimasukkan ke ledger utama.`,
            jumlah_kasar:  jumlahKasar,
            jumlah_bersih: jumlahBersih,
        });
    } catch (error) {
        await conn.rollback();
        console.error('[KEWANGAN] Gagal rekod tuntutan MAKSWIP:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan tuntutan.' });
    } finally {
        conn.release();
    }
};

// ==========================================
// 9. PRODUK PALING LARIS (dari pesanan yang selesai)
//    GET /api/admin/kewangan/produk-laris?tahun=2025
// ==========================================
export const getProdukLaris = async (req, res) => {
    const tahun = req.query.tahun || new Date().getFullYear();
    const had   = Math.min(parseInt(req.query.had) || 15, 25);
    try {
        const [rows] = await db.query(`
            SELECT
                pr.id, pr.nama_produk,
                pr.harga  AS harga_jual,
                pr.gambar,
                pr.stok_semasa AS stok_baki,
                COALESCE(SUM(i.kuantiti), 0) AS unit_terjual,
                COALESCE(SUM(i.kuantiti * i.harga_seunit), 0) AS hasil_jualan
            FROM produk_kedai pr
            LEFT JOIN item_pesanan i ON i.produk_id = pr.id
            LEFT JOIN pesanan_kedai p ON i.pesanan_id = p.id
                AND p.status_pesanan IN ('DIBAYAR','DIPROSES','SELESAI')
                AND YEAR(p.tarikh_pesanan) = ?
            GROUP BY pr.id, pr.nama_produk, pr.harga, pr.gambar, pr.stok_semasa
            ORDER BY unit_terjual DESC, hasil_jualan DESC
            LIMIT ?
        `, [tahun, had]);
        return res.status(200).json({
            success: true,
            data: rows.map(r => ({
                ...r,
                unit_terjual: parseInt(r.unit_terjual)   || 0,
                hasil_jualan: parseFloat(r.hasil_jualan) || 0,
                harga_jual:   parseFloat(r.harga_jual)   || 0,
            })),
        });
    } catch (error) {
        console.error('[KEWANGAN] getProdukLaris:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik data produk laris.' });
    }
};

// ==========================================
// 10. LAPORAN BULANAN
//     GET /api/admin/kewangan/laporan-bulanan?tahun=YYYY&bulan=MM
// ==========================================
export const getLaporanBulanan = async (req, res) => {
    const { tahun, bulan } = req.query;
    if (!tahun || !bulan) {
        return res.status(400).json({ success: false, message: 'Parameter tahun dan bulan diperlukan.' });
    }
    try {
        const [rows] = await db.query(`
            SELECT
                t.id, t.jenis_aliran, t.kategori, t.amaun, t.rujukan, t.nota, t.penerima_bayaran,
                u.nama_pegawai AS nama_ahli,
                DATE_FORMAT(t.tarikh_transaksi, '%d-%m-%Y %H:%i') AS tarikh
            FROM transaksi_kewangan t
            LEFT JOIN users u
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE YEAR(t.tarikh_transaksi) = ? AND MONTH(t.tarikh_transaksi) = ?
            ORDER BY t.tarikh_transaksi ASC
        `, [tahun, bulan]);
        const masuk  = rows.filter(r => r.jenis_aliran === 'MASUK').reduce((a, b) => a + parseFloat(b.amaun), 0);
        const keluar = rows.filter(r => r.jenis_aliran === 'KELUAR').reduce((a, b) => a + parseFloat(b.amaun), 0);
        return res.status(200).json({
            success: true, data: rows,
            ringkasan: { masuk, keluar, lebihan: masuk - keluar, bil: rows.length },
        });
    } catch (error) {
        console.error('[KEWANGAN] getLaporanBulanan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik laporan bulanan.' });
    }
};

// ==========================================
// 11. LAPORAN HARIAN
//     GET /api/admin/kewangan/laporan-harian?tarikh=YYYY-MM-DD
// ==========================================
export const getLaporanHarian = async (req, res) => {
    const { tarikh } = req.query;
    if (!tarikh) {
        return res.status(400).json({ success: false, message: 'Parameter tarikh (YYYY-MM-DD) diperlukan.' });
    }
    try {
        const [rows] = await db.query(`
            SELECT
                t.id, t.jenis_aliran, t.kategori, t.amaun, t.rujukan, t.nota, t.penerima_bayaran,
                u.nama_pegawai AS nama_ahli,
                DATE_FORMAT(t.tarikh_transaksi, '%H:%i') AS masa,
                DATE_FORMAT(t.tarikh_transaksi, '%d-%m-%Y %H:%i') AS tarikh
            FROM transaksi_kewangan t
            LEFT JOIN users u
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE DATE(t.tarikh_transaksi) = ?
            ORDER BY t.tarikh_transaksi ASC
        `, [tarikh]);
        const masuk  = rows.filter(r => r.jenis_aliran === 'MASUK').reduce((a, b) => a + parseFloat(b.amaun), 0);
        const keluar = rows.filter(r => r.jenis_aliran === 'KELUAR').reduce((a, b) => a + parseFloat(b.amaun), 0);
        return res.status(200).json({
            success: true, data: rows,
            ringkasan: { masuk, keluar, lebihan: masuk - keluar, bil: rows.length },
        });
    } catch (error) {
        console.error('[KEWANGAN] getLaporanHarian:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik laporan harian.' });
    }
};

// ==========================================
// 12. REKOD TRANSAKSI MANUAL (Masuk atau Keluar)
//     POST /api/admin/kewangan/rekod
// ==========================================
export const rekodTransaksi = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { jenis, kategori, amaun, nota, rujukan, no_kp_pihak, penerima_bayaran, tarikh, acara_khas_id } = req.body;

    if (!['MASUK', 'KELUAR'].includes(jenis)) {
        return res.status(400).json({ success: false, message: 'Jenis transaksi tidak sah.' });
    }
    if (!kategori || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi kategori dan amaun yang sah.' });
    }

    const kpPihak   = (jenis === 'KELUAR' && kategori === 'KEBAJIKAN') ? (no_kp_pihak || null) : null;
    const namaPihak = (jenis === 'KELUAR' && kategori !== 'KEBAJIKAN')
        ? (penerima_bayaran || null)
        : (jenis === 'MASUK' ? (penerima_bayaran || null) : null);
    const acaraId   = acara_khas_id ? parseInt(acara_khas_id) : null;

    const failDokumen = req.files?.length
        ? JSON.stringify(req.files.map(f => `/uploads/kewangan/${f.filename}`))
        : null;

    try {
        await db.query(`
            INSERT INTO transaksi_kewangan
                (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, penerima_bayaran, direkod_oleh, tarikh_transaksi, acara_khas_id, fail_dokumen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            jenis, kategori, parseFloat(amaun),
            rujukan || null, nota || null,
            kpPihak, namaPihak, no_kp_admin,
            tarikh ? new Date(tarikh) : new Date(),
            acaraId, failDokumen,
        ]);
        return res.status(201).json({
            success: true,
            message: `Rekod ${jenis === 'MASUK' ? 'pemasukan' : 'perbelanjaan'} berjaya disimpan.`,
        });
    } catch (error) {
        console.error('[KEWANGAN] rekodTransaksi:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan rekod kewangan.' });
    }
};

// ==========================================
// 13. KEMASKINI TRANSAKSI
//     PUT /api/admin/kewangan/transaksi/:id
// ==========================================
export const kemaskiniTransaksi = async (req, res) => {
    const { id } = req.params;
    const { jenis_aliran, kategori, amaun, nota, rujukan, penerima_bayaran, tarikh, fail_padam } = req.body;

    if (!['MASUK', 'KELUAR'].includes(jenis_aliran)) {
        return res.status(400).json({ success: false, message: 'Jenis aliran tidak sah.' });
    }
    if (!kategori || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi kategori dan amaun yang sah.' });
    }

    try {
        // Ambil state sedia ada (untuk log perubahan + fail_dokumen)
        const [[rekod]] = await db.query(`
            SELECT jenis_aliran, kategori, amaun, nota, rujukan, penerima_bayaran,
                   DATE_FORMAT(tarikh_transaksi, '%Y-%m-%d') AS tarikh_asal, fail_dokumen
            FROM transaksi_kewangan WHERE id = ?
        `, [id]);
        if (!rekod) return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });

        let failSediaAda = [];
        try { failSediaAda = JSON.parse(rekod.fail_dokumen || '[]'); } catch { failSediaAda = []; }

        // Padam fail yang diminta
        const senaraiFailPadam = fail_padam ? JSON.parse(fail_padam) : [];
        for (const failPath of senaraiFailPadam) {
            const fullPath = path.join(__dirname, '../public', failPath);
            fs.unlink(fullPath, () => {});
        }
        const failKekal = failSediaAda.filter(f => !senaraiFailPadam.includes(f));

        // Tambah fail baru
        const failBaru = (req.files || []).map(f => `/uploads/kewangan/${f.filename}`);
        const failAkhir = [...failKekal, ...failBaru];
        const failDokumenJson = failAkhir.length ? JSON.stringify(failAkhir) : null;

        const [result] = await db.query(`
            UPDATE transaksi_kewangan
            SET jenis_aliran = ?, kategori = ?, amaun = ?,
                nota = ?, rujukan = ?, penerima_bayaran = ?,
                tarikh_transaksi = ?, fail_dokumen = ?
            WHERE id = ?
        `, [
            jenis_aliran, kategori, parseFloat(amaun),
            nota || null, rujukan || null, penerima_bayaran || null,
            tarikh ? new Date(tarikh) : new Date(),
            failDokumenJson, id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });
        }

        // Log perubahan — simpan sebelum & selepas
        const sebelum = {
            jenis_aliran:     rekod.jenis_aliran,
            kategori:         rekod.kategori,
            amaun:            parseFloat(rekod.amaun),
            nota:             rekod.nota || null,
            rujukan:          rekod.rujukan || null,
            penerima_bayaran: rekod.penerima_bayaran || null,
            tarikh:           rekod.tarikh_asal,
        };
        const selepas = {
            jenis_aliran:     jenis_aliran,
            kategori:         kategori,
            amaun:            parseFloat(amaun),
            nota:             nota || null,
            rujukan:          rujukan || null,
            penerima_bayaran: penerima_bayaran || null,
            tarikh:           tarikh || rekod.tarikh_asal,
        };
        await db.query(
            `INSERT INTO log_edit_transaksi (transaksi_id, diedit_oleh, sebelum, selepas) VALUES (?, ?, ?, ?)`,
            [id, req.user.no_kp, JSON.stringify(sebelum), JSON.stringify(selepas)]
        );

        return res.status(200).json({ success: true, message: 'Rekod berjaya dikemaskini.' });
    } catch (error) {
        console.error('[KEWANGAN] kemaskiniTransaksi:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini rekod.' });
    }
};

// ==========================================
// 14. PADAM TRANSAKSI
//     DELETE /api/admin/kewangan/transaksi/:id
// ==========================================
export const padamTransaksi = async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM transaksi_kewangan WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });
        }
        return res.status(200).json({ success: true, message: 'Rekod berjaya dipadam.' });
    } catch (error) {
        console.error('[KEWANGAN] padamTransaksi:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat memadam rekod.' });
    }
};

// ==========================================
// 14b. LOG EDIT TRANSAKSI
//      GET /api/admin/kewangan/transaksi/:id/log
// ==========================================
export const getLogEditTransaksi = async (req, res) => {
    const { id } = req.params;
    try {
        const [log] = await db.query(`
            SELECT l.id, l.transaksi_id, l.tarikh_edit, l.sebelum, l.selepas,
                   l.diedit_oleh, u.nama_pegawai AS nama_editor
            FROM log_edit_transaksi l
            LEFT JOIN users u ON CONVERT(l.diedit_oleh USING utf8mb4) COLLATE utf8mb4_unicode_ci
                               = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE l.transaksi_id = ?
            ORDER BY l.tarikh_edit DESC
        `, [id]);
        return res.status(200).json({ success: true, data: log });
    } catch (error) {
        console.error('[KEWANGAN] getLogEditTransaksi:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat mendapatkan log.' });
    }
};

// ==========================================
// 4. EKSPORT CSV
//    GET /api/admin/kewangan/eksport?tahun=2025
// ==========================================
export const eksportCSV = async (req, res) => {
    const tahun = req.query.tahun || new Date().getFullYear();

    try {
        const [rows] = await db.query(`
            SELECT
                t.id,
                DATE_FORMAT(t.tarikh_transaksi, '%d/%m/%Y %H:%i') AS tarikh,
                t.jenis_aliran, t.kategori, t.amaun, t.rujukan, t.nota,
                COALESCE(u.nama_pegawai, t.penerima_bayaran, '-') AS pihak
            FROM transaksi_kewangan t
            LEFT JOIN users u 
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci 
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE YEAR(t.tarikh_transaksi) = ?
            ORDER BY t.tarikh_transaksi DESC
        `, [tahun]);

        const header = 'ID,Tarikh,Jenis,Kategori,Amaun (RM),Rujukan,Nota,Pihak\n';
        const body = rows.map(r =>
            `${r.id},"${r.tarikh}","${r.jenis_aliran}","${r.kategori}",${r.amaun},"${r.rujukan || ''}","${r.nota || ''}","${r.pihak}"`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="buku_tunai_${tahun}.csv"`);
        return res.status(200).send('\uFEFF' + header + body);

    } catch (error) {
        console.error('[KEWANGAN] Gagal eksport CSV:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat eksport data.' });
    }
};

// ==========================================
// PAKEJ SUMBANGAN — SENARAI PER ACARA
// GET /api/admin/kewangan/acara-khas/:id/pakej
// ==========================================
export const getPakejSumbangan = async (req, res) => {
    const { id } = req.params;
    try {
        const [pakej] = await db.query(`
            SELECT p.id, p.nama, p.amaun_pakej, p.status,
                COUNT(k.id) AS bil_penyumbang,
                COALESCE(SUM(k.amaun), 0) AS jumlah_kutipan
            FROM pakej_sumbangan p
            LEFT JOIN kutipan_sumbangan_luar k ON k.pakej_id = p.id
            WHERE p.acara_khas_id = ?
            GROUP BY p.id
            ORDER BY p.status ASC, p.tarikh_cipta ASC
        `, [id]);
        return res.json({ success: true, data: pakej });
    } catch (e) {
        console.error('[PAKEJ] getPakejSumbangan:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai pakej.' });
    }
};

// ==========================================
// PAKEJ SUMBANGAN — TAMBAH
// POST /api/admin/kewangan/acara-khas/:id/pakej
// ==========================================
export const tambahPakej = async (req, res) => {
    const { id } = req.params;
    const { nama, amaun_pakej } = req.body;
    if (!nama?.trim()) return res.status(400).json({ success: false, message: 'Nama pakej wajib diisi.' });
    try {
        const [result] = await db.query(
            'INSERT INTO pakej_sumbangan (acara_khas_id, nama, amaun_pakej) VALUES (?, ?, ?)',
            [id, nama.trim(), amaun_pakej ? parseFloat(amaun_pakej) : null]
        );
        return res.status(201).json({ success: true, message: 'Pakej berjaya ditambah.', id: result.insertId });
    } catch (e) {
        console.error('[PAKEJ] tambahPakej:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menambah pakej.' });
    }
};

// ==========================================
// PAKEJ SUMBANGAN — KEMASKINI
// PUT /api/admin/kewangan/pakej/:id
// ==========================================
export const kemaskiniPakej = async (req, res) => {
    const { id } = req.params;
    const { nama, amaun_pakej, status } = req.body;
    const fields = [];
    const values = [];
    if (nama !== undefined)       { fields.push('nama = ?');        values.push(nama.trim()); }
    if (amaun_pakej !== undefined) { fields.push('amaun_pakej = ?'); values.push(amaun_pakej ? parseFloat(amaun_pakej) : null); }
    if (status !== undefined)     { fields.push('status = ?');      values.push(status); }
    if (!fields.length) return res.status(400).json({ success: false, message: 'Tiada data untuk dikemaskini.' });
    values.push(id);
    try {
        await db.query(`UPDATE pakej_sumbangan SET ${fields.join(', ')} WHERE id = ?`, values);
        return res.json({ success: true, message: 'Pakej berjaya dikemaskini.' });
    } catch (e) {
        console.error('[PAKEJ] kemaskiniPakej:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini pakej.' });
    }
};

// ==========================================
// STAFF — SENARAI UNTUK DROPDOWN PIC
// GET /api/admin/kewangan/staff
// ==========================================
export const getSenaraiStaff = async (req, res) => {
    try {
        const [staff] = await db.query(`
            SELECT no_kp, nama_pegawai AS nama, jawatan_kelab AS jawatan
            FROM users
            WHERE status_ahli = 'aktif' AND role != 'Ahli'
            ORDER BY nama_pegawai ASC
        `);
        return res.json({ success: true, data: staff });
    } catch (e) {
        console.error('[STAFF] getSenaraiStaff:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai staff.' });
    }
};

// ==========================================
// ACARA KHAS — SENARAI
// GET /api/admin/kewangan/acara-khas
// ==========================================
export const getAcaraKhas = async (req, res) => {
    try {
        const [senarai] = await db.query(`
            SELECT a.id, a.nama, a.deskripsi, a.status, a.tarikh_mula, a.tarikh_tamat, a.tarikh_cipta,
                COUNT(t.id) AS bil_transaksi,
                COALESCE(SUM(CASE WHEN t.jenis_aliran = 'MASUK'  THEN t.amaun END), 0) AS jumlah_masuk,
                COALESCE(SUM(CASE WHEN t.jenis_aliran = 'KELUAR' THEN t.amaun END), 0) AS jumlah_keluar
            FROM acara_khas a
            LEFT JOIN transaksi_kewangan t ON t.acara_khas_id = a.id
            GROUP BY a.id
            ORDER BY a.status ASC, a.tarikh_cipta DESC
        `);
        return res.json({ success: true, data: senarai });
    } catch (e) {
        console.error('[ACARA_KHAS] getAcaraKhas:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai acara khas.' });
    }
};

// ==========================================
// ACARA KHAS — TAMBAH
// POST /api/admin/kewangan/acara-khas
// ==========================================
export const tambahAcaraKhas = async (req, res) => {
    const { nama, deskripsi, tarikh_mula, tarikh_tamat } = req.body;
    if (!nama?.trim()) {
        return res.status(400).json({ success: false, message: 'Nama acara wajib diisi.' });
    }
    try {
        const [result] = await db.query(`
            INSERT INTO acara_khas (nama, deskripsi, tarikh_mula, tarikh_tamat)
            VALUES (?, ?, ?, ?)
        `, [nama.trim(), deskripsi || null, tarikh_mula || null, tarikh_tamat || null]);
        return res.status(201).json({ success: true, message: 'Acara khas berjaya ditambah.', id: result.insertId });
    } catch (e) {
        console.error('[ACARA_KHAS] tambahAcaraKhas:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menambah acara khas.' });
    }
};

// ==========================================
// ACARA KHAS — KEMASKINI
// PUT /api/admin/kewangan/acara-khas/:id
// ==========================================
export const kemaskiniAcaraKhas = async (req, res) => {
    const { id } = req.params;
    const { nama, deskripsi, status, tarikh_mula, tarikh_tamat } = req.body;
    const [[acara]] = await db.query('SELECT id FROM acara_khas WHERE id = ?', [id]);
    if (!acara) return res.status(404).json({ success: false, message: 'Acara khas tidak dijumpai.' });

    const fields = [];
    const values = [];
    if (nama !== undefined)         { fields.push('nama = ?');         values.push(nama.trim()); }
    if (deskripsi !== undefined)    { fields.push('deskripsi = ?');    values.push(deskripsi || null); }
    if (status !== undefined)       { fields.push('status = ?');       values.push(status); }
    if (tarikh_mula !== undefined)  { fields.push('tarikh_mula = ?');  values.push(tarikh_mula || null); }
    if (tarikh_tamat !== undefined) { fields.push('tarikh_tamat = ?'); values.push(tarikh_tamat || null); }
    if (!fields.length) return res.status(400).json({ success: false, message: 'Tiada data untuk dikemaskini.' });
    values.push(id);

    try {
        await db.query(`UPDATE acara_khas SET ${fields.join(', ')} WHERE id = ?`, values);
        return res.json({ success: true, message: 'Acara khas berjaya dikemaskini.' });
    } catch (e) {
        console.error('[ACARA_KHAS] kemaskiniAcaraKhas:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini acara khas.' });
    }
};

// ==========================================
// ACARA KHAS — PENYATA KHAS
// GET /api/admin/kewangan/acara-khas/:id/penyata
// ==========================================
export const getPenyataAcaraKhas = async (req, res) => {
    const { id } = req.params;
    try {
        const [[acara]] = await db.query('SELECT * FROM acara_khas WHERE id = ?', [id]);
        if (!acara) return res.status(404).json({ success: false, message: 'Acara khas tidak dijumpai.' });

        const [transaksi] = await db.query(`
            SELECT
                t.id, t.jenis_aliran, t.kategori, t.amaun,
                t.rujukan, t.nota, t.penerima_bayaran,
                u.nama_pegawai AS nama_ahli,
                DATE_FORMAT(t.tarikh_transaksi, '%d-%m-%Y %H:%i') AS tarikh,
                DATE_FORMAT(t.tarikh_transaksi, '%Y-%m-%d') AS tarikh_raw
            FROM transaksi_kewangan t
            LEFT JOIN users u
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE t.acara_khas_id = ?
            ORDER BY t.tarikh_transaksi ASC
        `, [id]);

        const jumlahMasuk  = transaksi.filter(r => r.jenis_aliran === 'MASUK').reduce((s, r) => s + parseFloat(r.amaun), 0);
        const jumlahKeluar = transaksi.filter(r => r.jenis_aliran === 'KELUAR').reduce((s, r) => s + parseFloat(r.amaun), 0);

        // Sumbangan MAKSWIP yang dikutip (apa yang penyumbang bayar ke MAKSWIP)
        const [sumbangan] = await db.query(`
            SELECT k.id, k.nama_syarikat, k.amaun, DATE_FORMAT(k.tarikh, '%d-%m-%Y') AS tarikh,
                   k.nota,
                   k.pakej_id, p.nama AS nama_pakej,
                   k.pic_no_kp, u.nama_pegawai AS nama_pic
            FROM kutipan_sumbangan_luar k
            LEFT JOIN pakej_sumbangan p ON k.pakej_id = p.id
            LEFT JOIN users u ON CONVERT(k.pic_no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
                               = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            WHERE k.acara_khas_id = ?
            ORDER BY k.tarikh ASC
        `, [id]);
        const jumlahSumbanganKasar = sumbangan.reduce((s, r) => s + parseFloat(r.amaun), 0);

        // Tuntutan MAKSWIP — apa yang sebenarnya diterima dari MAKSWIP (berbeza sebab cas/potongan)
        const [tuntutan] = await db.query(`
            SELECT id, nama_acara, jumlah_kasar, potongan, jumlah_bersih,
                   DATE_FORMAT(tarikh_tuntutan, '%d-%m-%Y') AS tarikh_tuntutan,
                   nota, fail_dokumen
            FROM tuntutan_makswip
            WHERE acara_khas_id = ?
            ORDER BY tarikh_tuntutan ASC
        `, [id]);
        const jumlahDiterimaMakswip = tuntutan.reduce((s, r) => s + parseFloat(r.jumlah_bersih), 0);
        const selisihCas            = parseFloat((jumlahSumbanganKasar - jumlahDiterimaMakswip).toFixed(2));

        return res.json({
            success: true,
            acara,
            transaksi,
            sumbangan,
            tuntutan,
            ringkasan: {
                jumlah_masuk:           jumlahMasuk,
                jumlah_keluar:          jumlahKeluar,
                baki:                   jumlahMasuk - jumlahKeluar,
                bil_transaksi:          transaksi.length,
                sumbangan_kasar:        jumlahSumbanganKasar,
                bil_sumbangan:          sumbangan.length,
                jumlah_diterima_makswip: jumlahDiterimaMakswip,
                bil_tuntutan:           tuntutan.length,
                selisih_cas:            selisihCas,
            },
        });
    } catch (e) {
        console.error('[ACARA_KHAS] getPenyataAcaraKhas:', e.message);
        return res.status(500).json({ success: false, message: 'Ralat menjana penyata acara khas.' });
    }
};