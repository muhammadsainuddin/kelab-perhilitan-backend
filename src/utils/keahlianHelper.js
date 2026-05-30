import db from '../config/db.js';

// =====================================================================
// HELPER BERSAMA: KEAHLIAN
// Digunakan oleh: bayaranController, adminController, userController
// Letakkan fail ini di: src/utils/keahlianHelper.js
// =====================================================================

/**
 * Jana nombor ahli baharu dengan format KP-0001/2026.
 * Running number BERTERUSAN (tidak reset setiap tahun) — kita ambil
 * nombor tertinggi merentas SEMUA tahun, kemudian +1.
 * Tahun dalam nombor ialah tahun semasa penjanaan.
 *
 * Contoh: KP-0001/2026, KP-0002/2026, ... KP-0153/2027 (tahun berubah,
 * nombor terus menaik).
 *
 * @returns {Promise<string>} no_ahli baharu, cth: "KP-0042/2026"
 */
export const janaNoAhliBaru = async () => {
    const tahun = new Date().getFullYear();

    // Ambil nombor running tertinggi sedia ada merentas semua tahun.
    // no_ahli format: KP-<nombor>/<tahun>  -> kita ekstrak <nombor>.
    const [rows] = await db.query(`
        SELECT no_ahli
        FROM users
        WHERE no_ahli IS NOT NULL AND no_ahli != ''
    `);

    let maxNum = 0;
    for (const r of rows) {
        // Ekstrak bahagian nombor: "KP-0042/2026" -> "0042"
        const match = String(r.no_ahli).match(/KP-(\d+)\//);
        if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
        }
    }

    const nextNum = maxNum + 1;
    return `KP-${nextNum.toString().padStart(4, '0')}/${tahun}`;
};

/**
 * Tentukan sama ada seseorang ahli dikira "berbayar" untuk tahun semasa.
 * Peraturan:
 *   - Potongan Biro angkasa -> SENTIASA berbayar (true)
 *   - Bayar secara manual    -> berbayar jika ada sejarah_bayaran
 *                               status 'BERJAYA' untuk tahun semasa
 *
 * @param {string} no_kp
 * @param {string} jenis_potongan  nilai dari users.jenis_potongan
 * @returns {Promise<boolean>}
 */
export const semakStatusBerbayar = async (no_kp, jenis_potongan) => {
    // Biro Angkasa sentiasa berbayar
    if (jenis_potongan === 'Potongan Biro angkasa') {
        return true;
    }

    // Manual: semak rekod bayaran BERJAYA tahun semasa
    const currentYear = new Date().getFullYear();
    const [bayaran] = await db.query(`
        SELECT MAX(YEAR(tarikh_cipta)) AS last_paid_year
        FROM sejarah_bayaran
        WHERE no_kp = ? AND status = 'BERJAYA'
    `, [no_kp]);

    const lastPaidYear = bayaran[0]?.last_paid_year || null;
    return !!(lastPaidYear && lastPaidYear >= currentYear);
};