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
    const { jenis, kategori, cari, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        let conditions = [];
        let params = [];

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