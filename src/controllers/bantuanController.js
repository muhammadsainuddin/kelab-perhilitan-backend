import db from '../config/db.js';

// ── Migration: kolum waris dalam bantuan_kebajikan ───────────────────
(async () => {
    const kolumBaru = [
        "ADD COLUMN IF NOT EXISTS bagi_pihak TINYINT(1) NOT NULL DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS pemohon_admin_no_kp VARCHAR(20) DEFAULT NULL",
        "ADD COLUMN IF NOT EXISTS nama_waris VARCHAR(200) DEFAULT NULL",
        "ADD COLUMN IF NOT EXISTS no_kp_waris VARCHAR(20) DEFAULT NULL",
        "ADD COLUMN IF NOT EXISTS hubungan_waris VARCHAR(100) DEFAULT NULL",
        "ADD COLUMN IF NOT EXISTS no_akaun_waris VARCHAR(50) DEFAULT NULL",
        "ADD COLUMN IF NOT EXISTS nama_bank_waris VARCHAR(100) DEFAULT NULL",
    ];
    for (const kolum of kolumBaru) {
        try {
            await db.query(`ALTER TABLE bantuan_kebajikan ${kolum}`);
        } catch (e) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error('[Migration] bantuan_kebajikan waris:', e.message);
        }
    }
})();

// ── Migration: jadual kadar_bantuan ──────────────────────────────────
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS kadar_bantuan (
                kunci      VARCHAR(100)   NOT NULL PRIMARY KEY,
                amaun      DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
                label      VARCHAR(200)   NOT NULL,
                boleh_ubah TINYINT(1)     NOT NULL DEFAULT 1
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const defaults = [
            ['khairat_kematian',       1000.00, 'Khairat Kematian',                              1],
            ['kemalangan_rawatan_luar', 100.00, 'Kemalangan - Rawatan Luar (Tanpa Wad)',          1],
            ['kemalangan_wad',          100.00, 'Kemalangan - Dimasukkan Wad',                    1],
            ['bencana_banjir',          300.00, 'Bencana Alam - Banjir',                          1],
            ['bencana_kebakaran',       300.00, 'Bencana Alam - Kebakaran',                       1],
            ['persaraan',               400.00, 'Persaraan',                                      1],
        ];
        for (const [kunci, amaun, label, boleh_ubah] of defaults)
            await db.query(
                'INSERT IGNORE INTO kadar_bantuan (kunci, amaun, label, boleh_ubah) VALUES (?,?,?,?)',
                [kunci, amaun, label, boleh_ubah]
            );
        console.log('[Migration] kadar_bantuan: siap.');
    } catch (e) {
        console.error('[Migration] kadar_bantuan gagal:', e.message);
    }
})();

// Peta jenis_bantuan → kunci kadar_bantuan
const PETA_KUNCI = {
    'Khairat Kematian':                        'khairat_kematian',
    'Kemalangan - Rawatan Luar (Tanpa Wad)':   'kemalangan_rawatan_luar',
    'Kemalangan - Dimasukkan Wad':             'kemalangan_wad',
    'Bencana Alam - Banjir':                   'bencana_banjir',
    'Bencana Alam - Kebakaran':                'bencana_kebakaran',
    'Persaraan':                               'persaraan',
};

// ==========================================
// Kadar Bantuan: Ambil semua kadar
// ==========================================
export const ambilKadar = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT kunci, amaun, label, boleh_ubah FROM kadar_bantuan ORDER BY FIELD(kunci, "khairat_kematian","kemalangan_rawatan_luar","kemalangan_wad","bencana_banjir","bencana_kebakaran","persaraan")');
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat server.' });
    }
};

// ==========================================
// Kadar Bantuan: Kemaskini kadar (YDP sahaja)
// ==========================================
export const kemaskiniKadar = async (req, res) => {
    const { kunci } = req.params;
    const amaun = parseFloat(req.body.amaun);

    if (isNaN(amaun) || amaun < 0) {
        return res.status(400).json({ success: false, message: 'Amaun tidak sah.' });
    }

    // Semak jawatan YDP dari DB
    const [[admin]] = await db.query('SELECT jawatan_kelab FROM users WHERE no_kp = ?', [req.user.no_kp]);
    if (!admin || admin.jawatan_kelab !== 'Yang Dipertua') {
        return res.status(403).json({ success: false, message: 'Hanya Yang Dipertua sahaja yang boleh mengubah kadar bantuan.' });
    }

    try {
        const [result] = await db.query(
            'UPDATE kadar_bantuan SET amaun = ? WHERE kunci = ? AND boleh_ubah = 1',
            [amaun, kunci]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Kadar tidak dijumpai atau tidak boleh diubah.' });
        }
        res.json({ success: true, message: 'Kadar bantuan berjaya dikemaskini.' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ralat server.' });
    }
};

// ==========================================
// Ahli: Hantar Permohonan Bantuan
// ==========================================
export const mohonBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { jenis_bantuan, keterangan } = req.body;
    
    // Memandangkan frontend menghantar pelbagai fail (Maksimum 20), kita gunakan req.files
    let dokumenArray = [];
    
    if (req.files && req.files.length > 0) {
        // Ekstrak hanya nama fail yang telah disimpan oleh multer
        dokumenArray = req.files.map(file => file.filename);
    }
    
    // Tukar array nama fail menjadi format teks JSON untuk disimpan ke dalam database
    const dokumenString = dokumenArray.length > 0 ? JSON.stringify(dokumenArray) : null;

    try {
        await db.query(
            `INSERT INTO bantuan_kebajikan (no_kp, jenis_bantuan, keterangan, dokumen_sokongan) VALUES (?, ?, ?, ?)`,
            [no_kp, jenis_bantuan, keterangan, dokumenString]
        );
        res.status(201).json({ success: true, message: "Permohonan bantuan berjaya dihantar kepada Urusetia." });
    } catch (error) {
        console.error("Ralat Mohon Bantuan:", error);
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan." });
    }
};

// ==========================================
// Ahli: Lihat Sejarah Permohonan Sendiri
// ==========================================
export const sejarahBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    
    try {
        const [sejarah] = await db.query(
            `SELECT * FROM bantuan_kebajikan WHERE no_kp = ? ORDER BY tarikh_mohon DESC`,
            [no_kp]
        );
        
        // Parse semula rentetan teks JSON kepada bentuk Array supaya mudah dibaca oleh Frontend
        const formattedSejarah = sejarah.map(item => {
            let senaraiDokumen = [];
            if (item.dokumen_sokongan) {
                try {
                    senaraiDokumen = JSON.parse(item.dokumen_sokongan);
                } catch (e) {
                    // Fallback jika rekod lama tidak menggunakan format JSON (hanya ada 1 fail)
                    senaraiDokumen = [item.dokumen_sokongan];
                }
            }
            
            return {
                ...item,
                dokumen_sokongan: senaraiDokumen // Sekarang ia sentiasa dalam format Array
            };
        });

        res.status(200).json({ success: true, data: formattedSejarah });
    } catch (error) {
        console.error("Ralat Sejarah Bantuan:", error);
        res.status(500).json({ success: false, message: "Ralat memuatkan sejarah permohonan." });
    }
};

// ==========================================
// Admin: Mohon Bantuan Bagi Pihak Waris (Si Mati)
// ==========================================
export const mohonBantuanBagiPihak = async (req, res) => {
    const pemohon_admin_no_kp = req.user.no_kp;
    const {
        no_kp_simati,
        jenis_bantuan,
        keterangan,
        nama_waris,
        no_kp_waris,
        hubungan_waris,
        no_akaun_waris,
        nama_bank_waris,
    } = req.body;

    if (!no_kp_simati || !jenis_bantuan || !nama_waris || !no_akaun_waris || !nama_bank_waris || !hubungan_waris) {
        return res.status(400).json({
            success: false,
            message: 'Medan wajib: no_kp_simati, jenis_bantuan, nama_waris, hubungan_waris, no_akaun_waris, nama_bank_waris.',
        });
    }

    // Pastikan si mati adalah ahli berdaftar
    const [[simati]] = await db.query('SELECT no_kp, nama_pegawai FROM users WHERE no_kp = ?', [no_kp_simati]);
    if (!simati) {
        return res.status(404).json({ success: false, message: 'Ahli yang dipilih tidak dijumpai dalam sistem.' });
    }

    let dokumenString = null;
    if (req.files && req.files.length > 0) {
        dokumenString = JSON.stringify(req.files.map(f => f.filename));
    }

    try {
        await db.query(
            `INSERT INTO bantuan_kebajikan
                (no_kp, jenis_bantuan, keterangan, dokumen_sokongan,
                 bagi_pihak, pemohon_admin_no_kp,
                 nama_waris, no_kp_waris, hubungan_waris, no_akaun_waris, nama_bank_waris)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
            [
                no_kp_simati, jenis_bantuan, keterangan || null, dokumenString,
                pemohon_admin_no_kp,
                nama_waris, no_kp_waris || null, hubungan_waris, no_akaun_waris, nama_bank_waris,
            ]
        );
        res.status(201).json({
            success: true,
            message: `Permohonan bagi pihak waris arwah ${simati.nama_pegawai} berjaya dihantar.`,
        });
    } catch (error) {
        console.error('Ralat Mohon Bantuan Bagi Pihak:', error);
        res.status(500).json({ success: false, message: 'Gagal menghantar permohonan.' });
    }
};