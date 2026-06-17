import db from '../config/db.js';

// ─────────────────────────────────────────────────────────────
// UTILITI JANA NO. RESIT
// BA-YYYYMM-NNNNN  →  Biro Angkasa   (jadual resit_biro_angkasa)
// YR-YYYYMM-NNNNN  →  Manual / FPX   (jadual sejarah_bayaran)
// ─────────────────────────────────────────────────────────────

const janaNoResit = async (prefix, yyyymm) => {
    const header = `${prefix}-${yyyymm}-`;
    const jadual = prefix === 'BA' ? 'resit_biro_angkasa' : 'sejarah_bayaran';
    const [[{ cnt }]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM ${jadual} WHERE no_resit LIKE ?`,
        [`${header}%`]
    );
    return `${header}${String(Number(cnt) + 1).padStart(5, '0')}`;
};

const yyyymmDariBulan = (bulanStr) => bulanStr.replace('-', '');  // '2026-06' → '202606'

// ─────────────────────────────────────────────────────────────
// 1. JANA RESIT BIRO ANGKASA — SATU BULAN
//    POST /admin/resit-biro-angkasa/jana
//    Body: { bulan: 'YYYY-MM' }  (optional — default bulan semasa)
// ─────────────────────────────────────────────────────────────
export const janaResitBiroAngkasa = async (req, res) => {
    const dijana_oleh = req.user.no_kp;
    const bulan = req.body.bulan || new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(bulan))
        return res.status(400).json({ success: false, message: 'Format bulan tidak sah. Gunakan YYYY-MM.' });

    const bulanDate   = `${bulan}-01`;
    const tarikhResit = `${bulan}-10`;
    const header      = `BA-${yyyymmDariBulan(bulan)}-`;

    try {
        // Ambil ahli layak yang BELUM ada resit bulan ini — 1 query dengan LEFT JOIN
        const [ahliList] = await db.query(`
            SELECT u.no_kp, u.no_ahli, u.nama_pegawai, u.yuran_kelab_bulanan
            FROM users u
            LEFT JOIN resit_biro_angkasa r
                ON r.no_kp = u.no_kp AND r.bulan_potongan = ?
            WHERE u.jenis_potongan = 'Potongan Biro angkasa'
              AND u.status_ahli = 'aktif'
              AND u.tarikh_mula_potongan IS NOT NULL
              AND u.tarikh_mula_potongan <= ?
              AND r.id IS NULL
        `, [bulanDate, bulanDate]);

        // Kira yang sudah wujud
        const [[{ dilangkau }]] = await db.query(
            `SELECT COUNT(*) AS dilangkau FROM resit_biro_angkasa WHERE bulan_potongan = ?`,
            [bulanDate]
        );
        const bilDilangkau = Number(dilangkau);

        if (ahliList.length === 0)
            return res.json({ success: true, message: `Semua ahli sudah ada resit untuk ${bulan}.`, dijana: 0, dilangkau: bilDilangkau });

        // Urutan seterusnya
        const [[{ cnt }]] = await db.query(
            `SELECT COUNT(*) AS cnt FROM resit_biro_angkasa WHERE no_resit LIKE ?`,
            [`${header}%`]
        );
        let seq = Number(cnt);

        // Bina semua baris sekaligus
        const resitRows    = [];
        const kewanganRows = [];

        for (const ahli of ahliList) {
            seq++;
            const noResit = `${header}${String(seq).padStart(5, '0')}`;
            const amaun   = parseFloat(ahli.yuran_kelab_bulanan) || 5.00;

            resitRows.push([noResit, ahli.no_kp, ahli.no_ahli || null, ahli.nama_pegawai, amaun, bulanDate, tarikhResit, dijana_oleh]);
            kewanganRows.push(['MASUK', 'YURAN_BA', amaun, noResit,
                `Potongan Biro Angkasa — ${bulan} — ${ahli.nama_pegawai}`,
                ahli.no_kp, dijana_oleh, tarikhResit]);
        }

        // Satu transaksi, dua bulk INSERT
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query(`
                INSERT INTO resit_biro_angkasa
                    (no_resit, no_kp, no_ahli, nama_pegawai, amaun, bulan_potongan, tarikh_jana, dijana_oleh)
                VALUES ?
            `, [resitRows]);
            await conn.query(`
                INSERT INTO transaksi_kewangan
                    (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak, direkod_oleh, tarikh_transaksi)
                VALUES ?
            `, [kewanganRows]);
            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        res.json({
            success: true,
            message: `Resit bulan ${bulan} selesai. ${ahliList.length} dijana, ${bilDilangkau} sudah wujud.`,
            bulan,
            dijana: ahliList.length,
            dilangkau: bilDilangkau,
            jumlah_ahli: ahliList.length + bilDilangkau,
        });
    } catch (err) {
        console.error('[RESIT BA] Jana gagal:', err);
        res.status(500).json({ success: false, message: 'Ralat pelayan semasa menjana resit.' });
    }
};

// ─────────────────────────────────────────────────────────────
// 2. SENARAI RESIT BIRO ANGKASA (Admin)
//    GET /admin/resit-biro-angkasa
//    Query: bulan=YYYY-MM | no_kp=xxx | no_ahli=xxx | page=1
// ─────────────────────────────────────────────────────────────
export const senaraiResitBiroAdmin = async (req, res) => {
    const { bulan, no_kp, no_ahli, page = 1 } = req.query;
    const had = 50;
    const offset = (parseInt(page) - 1) * had;

    const syarat = [];
    const param  = [];

    if (bulan && /^\d{4}-\d{2}$/.test(bulan)) {
        syarat.push('r.bulan_potongan = ?');
        param.push(`${bulan}-01`);
    }
    if (no_kp)   { syarat.push('r.no_kp LIKE ?');   param.push(`%${no_kp}%`); }
    if (no_ahli) { syarat.push('r.no_ahli LIKE ?'); param.push(`%${no_ahli}%`); }

    const where = syarat.length ? `WHERE ${syarat.join(' AND ')}` : '';

    try {
        const [[{ jumlah }]] = await db.query(
            `SELECT COUNT(*) AS jumlah FROM resit_biro_angkasa r ${where}`,
            param
        );

        const [rows] = await db.query(`
            SELECT r.id, r.no_resit, r.no_kp, r.no_ahli, r.nama_pegawai,
                   r.amaun, DATE_FORMAT(r.bulan_potongan, '%Y-%m-%d') AS bulan_potongan,
                   DATE_FORMAT(r.tarikh_jana, '%Y-%m-%d') AS tarikh_jana, r.dijana_oleh,
                   p.nama_penempatan AS penempatan
            FROM resit_biro_angkasa r
            LEFT JOIN users u ON r.no_kp = u.no_kp
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            ${where}
            ORDER BY r.bulan_potongan DESC, r.no_resit ASC
            LIMIT ? OFFSET ?
        `, [...param, had, offset]);

        res.json({ success: true, data: rows, jumlah, page: parseInt(page), had });
    } catch (err) {
        console.error('[RESIT BA] Senarai gagal:', err);
        res.status(500).json({ success: false, message: 'Ralat menarik senarai resit.' });
    }
};

// ─────────────────────────────────────────────────────────────
// 3. STATISTIK RESIT BIRO ANGKASA (Admin)
//    GET /admin/resit-biro-angkasa/statistik
// ─────────────────────────────────────────────────────────────
export const statistikResitBiro = async (req, res) => {
    try {
        const [bulanList] = await db.query(`
            SELECT DATE_FORMAT(bulan_potongan, '%Y-%m') AS bulan,
                   COUNT(*) AS bilangan,
                   SUM(amaun) AS jumlah_kutipan
            FROM resit_biro_angkasa
            GROUP BY bulan_potongan
            ORDER BY bulan_potongan DESC
            LIMIT 24
        `);

        const [[{ jumlah_ahli_layak }]] = await db.query(`
            SELECT COUNT(*) AS jumlah_ahli_layak FROM users
            WHERE jenis_potongan = 'Potongan Biro angkasa'
              AND status_ahli = 'aktif'
              AND tarikh_mula_potongan IS NOT NULL
        `);

        res.json({ success: true, bulanList, jumlah_ahli_layak });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ralat statistik.' });
    }
};

// ─────────────────────────────────────────────────────────────
// 4. RESIT SAYA — BIRO ANGKASA (Ahli)
//    GET /user/resit-biro-angkasa
// ─────────────────────────────────────────────────────────────
export const resitSayaBiroAngkasa = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [rows] = await db.query(`
            SELECT no_resit, amaun,
                   DATE_FORMAT(bulan_potongan, '%Y-%m-%d') AS bulan_potongan,
                   DATE_FORMAT(tarikh_jana, '%Y-%m-%d') AS tarikh_jana
            FROM resit_biro_angkasa
            WHERE no_kp = ?
            ORDER BY bulan_potongan DESC
        `, [no_kp]);

        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ralat menarik resit anda.' });
    }
};

// ─────────────────────────────────────────────────────────────
// 5. DETAIL SATU RESIT (Admin & Ahli)
//    GET /admin/resit-biro-angkasa/:no_resit
//    GET /user/resit-biro-angkasa/:no_resit
// ─────────────────────────────────────────────────────────────
export const detailResitBiro = async (req, res) => {
    const { no_resit } = req.params;
    const callerNokp   = req.user.no_kp;
    const isAdmin      = ['Admin', 'Super Admin', 'Bendahari'].includes(req.user.role);

    try {
        const [[resit]] = await db.query(`
            SELECT r.*, p.nama_penempatan AS penempatan
            FROM resit_biro_angkasa r
            LEFT JOIN users u ON r.no_kp = u.no_kp
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE r.no_resit = ?
        `, [no_resit]);

        if (!resit)
            return res.status(404).json({ success: false, message: 'Resit tidak dijumpai.' });

        if (!isAdmin && resit.no_kp !== callerNokp)
            return res.status(403).json({ success: false, message: 'Tiada kebenaran.' });

        res.json({ success: true, data: resit });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ralat menarik detail resit.' });
    }
};

// ─────────────────────────────────────────────────────────────
// UTILITI LUARAN: Jana no_resit untuk sejarah_bayaran (FPX)
// Dipanggil dari paymentSync.js apabila bayaran BERJAYA
// ─────────────────────────────────────────────────────────────
export const janaNoResitManual = async (billCode) => {
    const now    = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const noResit = await janaNoResit('YR', yyyymm);
    await db.query('UPDATE sejarah_bayaran SET no_resit = ? WHERE billCode = ?', [noResit, billCode]);
    return noResit;
};
