import db from '../config/db.js';

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS tetapan_sistem (
                kunci   VARCHAR(50)  NOT NULL PRIMARY KEY,
                nilai   TINYINT(1)   NOT NULL DEFAULT 1,
                label   VARCHAR(100) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const defaults = [
            ['modul_kedai',   1, 'Kedai Merchandise'],
            ['modul_bantuan', 1, 'Bantuan Kebajikan'],
            ['modul_acara',   1, 'Acara & Aktiviti'],
        ];
        for (const [kunci, nilai, label] of defaults) {
            await db.query(
                'INSERT IGNORE INTO tetapan_sistem (kunci, nilai, label) VALUES (?, ?, ?)',
                [kunci, nilai, label]
            );
        }
        console.log('[Migration] tetapan_sistem: siap.');
    } catch (e) {
        console.error('[Migration] tetapan_sistem gagal:', e.message);
    }
})();

export const ambilTetapan = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT kunci, nilai, label FROM tetapan_sistem ORDER BY kunci'
        );
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, mesej: 'Ralat server' });
    }
};

export const kemaskiniTetapan = async (req, res) => {
    const { kunci } = req.params;
    const nilai = Number(req.body.nilai);
    if (![0, 1].includes(nilai)) {
        return res.status(400).json({ ok: false, mesej: 'Nilai tidak sah. Gunakan 0 atau 1.' });
    }
    try {
        const [result] = await db.query(
            'UPDATE tetapan_sistem SET nilai = ? WHERE kunci = ?',
            [nilai, kunci]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ ok: false, mesej: 'Tetapan tidak dijumpai' });
        }
        res.json({ ok: true, mesej: 'Tetapan berjaya dikemaskini' });
    } catch (e) {
        res.status(500).json({ ok: false, mesej: 'Ralat server' });
    }
};
