import db from '../config/db.js';

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
    const { jenis, kategori, cari, tahun, bulan, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        let conditions = [];
        let params = [];

        if (tahun)    { conditions.push('YEAR(t.tarikh_transaksi) = ?');  params.push(parseInt(tahun)); }
        if (bulan)    { conditions.push('MONTH(t.tarikh_transaksi) = ?'); params.push(parseInt(bulan)); }
        if (jenis)    { conditions.push('t.jenis_aliran = ?'); params.push(jenis); }
        if (kategori) { conditions.push('t.kategori = ?');     params.push(kategori); }
        if (cari) {
            conditions.push('(t.rujukan LIKE ? OR t.nota LIKE ? OR t.penerima_bayaran LIKE ? OR u.nama_pegawai LIKE ?)');
            params.push(`%${cari}%`, `%${cari}%`, `%${cari}%`, `%${cari}%`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        // Guna CONVERT pada kolom JOIN untuk elak konflik kolasi utf8mb4
        const [rows] = await db.query(`
            SELECT
                t.id, t.jenis_aliran, t.kategori, t.amaun,
                t.rujukan, t.nota, t.penerima_bayaran,
                u.nama_pegawai AS nama_ahli,
                DATE_FORMAT(t.tarikh_transaksi, '%d-%m-%Y %H:%i') AS tarikh
            FROM transaksi_kewangan t
            LEFT JOIN users u 
                ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci 
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            ${where}
            ORDER BY t.tarikh_transaksi DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM transaksi_kewangan t LEFT JOIN users u ON CONVERT(t.no_kp_pihak USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci ${where}`,
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
// 6. SUMBANGAN — SENARAI KUTIPAN
//    GET /api/admin/kewangan/sumbangan?tahun=2025
// ==========================================
export const getSenaraiSumbangan = async (req, res) => {
    const tahun = req.query.tahun || new Date().getFullYear();
    try {
        const [rows] = await db.query(`
            SELECT id, penerima_bayaran AS nama_penyumbang, amaun, rujukan AS program,
                   nota, DATE_FORMAT(tarikh_transaksi, '%d-%m-%Y') AS tarikh
            FROM transaksi_kewangan
            WHERE jenis_aliran = 'MASUK' AND kategori = 'SUMBANGAN'
              AND YEAR(tarikh_transaksi) = ?
            ORDER BY tarikh_transaksi DESC, id DESC
        `, [tahun]);
        const jumlah = rows.reduce((a, b) => a + parseFloat(b.amaun), 0);
        return res.status(200).json({ success: true, data: rows, jumlah });
    } catch (error) {
        console.error('[KEWANGAN] Gagal tarik sumbangan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menarik senarai sumbangan.' });
    }
};

// ==========================================
// 7. SUMBANGAN — REKOD SATU
//    POST /api/admin/kewangan/sumbangan
// ==========================================
export const rekodSumbangan = async (req, res) => {
    const no_kp_admin = req.user.no_kp;
    const { nama_penyumbang, amaun, program, nota, tarikh } = req.body;

    if (!nama_penyumbang || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi nama penyumbang dan amaun yang sah.' });
    }

    try {
        await db.query(`
            INSERT INTO transaksi_kewangan
                (jenis_aliran, kategori, amaun, rujukan, nota, penerima_bayaran, direkod_oleh, tarikh_transaksi)
            VALUES ('MASUK', 'SUMBANGAN', ?, ?, ?, ?, ?, ?)
        `, [
            parseFloat(amaun), program || null, nota || null,
            String(nama_penyumbang).trim(), no_kp_admin,
            tarikh ? new Date(tarikh) : new Date()
        ]);
        return res.status(201).json({ success: true, message: 'Sumbangan berjaya direkodkan.' });
    } catch (error) {
        console.error('[KEWANGAN] Gagal rekod sumbangan:', error.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan sumbangan.' });
    }
};

// ==========================================
// 8. SUMBANGAN — IMPORT PUKAL (dari CSV yang di-parse di frontend)
//    POST /api/admin/kewangan/sumbangan/import
//    Body: { senarai: [{ nama_penyumbang, amaun, program?, nota?, tarikh? }] }
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
            const nama = (s.nama_penyumbang || '').toString().trim();
            const amaun = parseFloat(s.amaun);
            if (!nama || !amaun || amaun <= 0) {
                dilangkau.push(i + 1);
                continue;
            }
            await conn.query(`
                INSERT INTO transaksi_kewangan
                    (jenis_aliran, kategori, amaun, rujukan, nota, penerima_bayaran, direkod_oleh, tarikh_transaksi)
                VALUES ('MASUK', 'SUMBANGAN', ?, ?, ?, ?, ?, ?)
            `, [
                amaun, s.program || null, s.nota || null, nama, no_kp_admin,
                s.tarikh ? new Date(s.tarikh) : new Date()
            ]);
            berjaya++;
        }

        await conn.commit();
        return res.status(201).json({
            success: true,
            message: `${berjaya} sumbangan berjaya diimport.` + (dilangkau.length ? ` ${dilangkau.length} baris dilangkau (data tidak lengkap).` : ''),
            berjaya, dilangkau
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
    const { jenis, kategori, amaun, nota, rujukan, no_kp_pihak, penerima_bayaran, tarikh } = req.body;

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

    try {
        await db.query(`
            INSERT INTO transaksi_kewangan
                (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, penerima_bayaran, direkod_oleh, tarikh_transaksi)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            jenis, kategori, parseFloat(amaun),
            rujukan || null, nota || null,
            kpPihak, namaPihak, no_kp_admin,
            tarikh ? new Date(tarikh) : new Date()
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
    const { jenis_aliran, kategori, amaun, nota, rujukan, penerima_bayaran, tarikh } = req.body;

    if (!['MASUK', 'KELUAR'].includes(jenis_aliran)) {
        return res.status(400).json({ success: false, message: 'Jenis aliran tidak sah.' });
    }
    if (!kategori || !amaun || parseFloat(amaun) <= 0) {
        return res.status(400).json({ success: false, message: 'Sila isi kategori dan amaun yang sah.' });
    }

    try {
        const [result] = await db.query(`
            UPDATE transaksi_kewangan
            SET jenis_aliran = ?, kategori = ?, amaun = ?,
                nota = ?, rujukan = ?, penerima_bayaran = ?,
                tarikh_transaksi = ?
            WHERE id = ?
        `, [
            jenis_aliran, kategori, parseFloat(amaun),
            nota || null, rujukan || null, penerima_bayaran || null,
            tarikh ? new Date(tarikh) : new Date(),
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Rekod tidak dijumpai.' });
        }
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