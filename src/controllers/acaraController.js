import db from '../config/db.js';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';

// Derive jantina dari no_kp — digit akhir ganjil = Lelaki, genap = Perempuan
const deriveJantina = (no_kp) => {
    if (!no_kp) return null;
    const last = parseInt(String(no_kp).replace(/-/g, '').slice(-1));
    return isNaN(last) ? null : (last % 2 === 1 ? 'Lelaki' : 'Perempuan');
};

// Migration IIFE — tambah kolum jantina, kategori_jantina, tarikh_tamat & maklumat pergerakan
;(async () => {
    try {
        const migrations = [
            `ALTER TABLE users ADD COLUMN jantina ENUM('Lelaki','Perempuan') NULL`,
            `ALTER TABLE acara ADD COLUMN kategori_jantina ENUM('Semua','Lelaki','Perempuan') NOT NULL DEFAULT 'Semua'`,
            `ALTER TABLE acara ADD COLUMN tarikh_tamat DATE NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN jantina ENUM('Lelaki','Perempuan') NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN tarikh_pergi DATE NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN tarikh_balik DATE NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN kaedah_pergerakan ENUM('Darat','Bot','Penerbangan') NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN no_penerbangan_pergi VARCHAR(20) NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN masa_penerbangan_pergi VARCHAR(10) NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN no_penerbangan_balik VARCHAR(20) NULL`,
            `ALTER TABLE penyertaan_acara ADD COLUMN masa_penerbangan_balik VARCHAR(10) NULL`,
        ];
        for (const sql of migrations) {
            try { await db.query(sql); } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
        }
        // Backfill jantina untuk semua users sedia ada
        await db.query(`
            UPDATE users SET jantina =
                CASE WHEN CAST(RIGHT(REPLACE(no_kp,'-',''),1) AS UNSIGNED) % 2 = 1
                     THEN 'Lelaki' ELSE 'Perempuan' END
            WHERE jantina IS NULL
        `);
        // Backfill jantina dalam penyertaan_acara sedia ada
        await db.query(`
            UPDATE penyertaan_acara pa
            JOIN users u ON pa.no_kp = u.no_kp
            SET pa.jantina = u.jantina
            WHERE pa.jantina IS NULL
        `);
    } catch (e) { console.error('Migration jantina gagal:', e.message); }
})();

const normalizeSenaraiSukan = (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (Array.isArray(val)) {
        return val.length > 0 ? JSON.stringify(val) : null;
    }
    if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed.length > 0 ? JSON.stringify(parsed) : null;
            return JSON.stringify([val]);
        } catch {
            return JSON.stringify([val]);
        }
    }
    return null;
};

const normalizeBenarkan = (val) => (val === true || val === 'true' || val === 1 || val === '1' ? 1 : 0);

// SQL fragment untuk semak status berbayar
const isPaidSQL = `
    CASE
        WHEN u.jenis_potongan = 'Potongan Biro angkasa' THEN 1
        WHEN EXISTS (
            SELECT 1 FROM sejarah_bayaran sb
            WHERE sb.no_kp = u.no_kp AND sb.status = 'BERJAYA' AND YEAR(sb.tarikh_kemaskini) = YEAR(CURDATE())
        ) THEN 1
        ELSE 0
    END
`;

// =====================================================================
// BAHAGIAN A — AHLI
// =====================================================================

// A1. Senarai acara AKTIF + tanda jika ahli ini sudah daftar + status penuh
export const senaraiAcaraAktif = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [[user]] = await db.query(`SELECT jantina FROM users WHERE no_kp = ?`, [no_kp]);
        const jantinaSaya = user?.jantina || deriveJantina(no_kp);

        const [acara] = await db.query(`
            SELECT
                a.id, a.nama_acara, a.jenis_acara, a.keterangan, a.lokasi,
                a.tarikh_acara, a.tarikh_tutup, a.poster,
                a.emel_urusetia, a.no_tel_urusetia, a.status,
                a.senarai_sukan, a.benarkan_pelbagai_sukan, a.had_peserta,
                a.kategori_jantina,
                (SELECT COUNT(*) FROM penyertaan_acara p WHERE p.acara_id = a.id) AS jumlah_peserta,
                EXISTS (
                    SELECT 1 FROM penyertaan_acara p2
                    WHERE p2.acara_id = a.id AND p2.no_kp = ?
                ) AS sudah_daftar
            FROM acara a
            WHERE a.status = 'AKTIF'
            ORDER BY a.tarikh_acara ASC
        `, [no_kp]);

        const data = acara.map(a => ({
            ...a,
            acara_penuh: a.had_peserta !== null && Number(a.jumlah_peserta) >= Number(a.had_peserta),
            jantina_sesuai: a.kategori_jantina === 'Semua' || a.kategori_jantina === jantinaSaya
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("Ralat Senarai Acara:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai acara." });
    }
};

// A2. Ahli daftar acara
export const sertaiAcara = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { acara_id, kategori, catatan, sukan_dipilih } = req.body;

    try {
        const [[userRow]] = await db.query(`SELECT jenis_potongan, jantina FROM users WHERE no_kp = ?`, [no_kp]);
        const isPaid = await semakStatusBerbayar(no_kp, userRow.jenis_potongan);
        if (!isPaid) return res.status(403).json({ success: false, message: "Sila jelaskan yuran tahunan." });

        const jantinaPeserta = userRow.jantina || deriveJantina(no_kp);

        const [[acara]] = await db.query(
            `SELECT id, status, tarikh_tutup, benarkan_pelbagai_sukan, had_peserta, kategori_jantina,
             (SELECT COUNT(*) FROM penyertaan_acara WHERE acara_id = a.id) AS jumlah_peserta
             FROM acara a WHERE id = ?`, [acara_id]
        );
        if (!acara) return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });
        if (acara.status !== 'AKTIF') return res.status(400).json({ success: false, message: "Pendaftaran ditutup." });

        if (acara.had_peserta !== null && Number(acara.jumlah_peserta) >= Number(acara.had_peserta)) {
            return res.status(400).json({ success: false, message: "Maaf, pendaftaran acara ini telah penuh." });
        }

        // Semak jantina
        if (acara.kategori_jantina !== 'Semua' && acara.kategori_jantina !== jantinaPeserta) {
            return res.status(403).json({
                success: false,
                message: `Acara ini hanya untuk kategori ${acara.kategori_jantina} sahaja.`
            });
        }

        if (sukan_dipilih && Array.isArray(sukan_dipilih) && sukan_dipilih.length > 1) {
            if (acara.benarkan_pelbagai_sukan === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Maaf, acara ini hanya membenarkan penyertaan untuk SATU sukan sahaja."
                });
            }
        }

        const [sedia] = await db.query(`SELECT id FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`, [acara_id, no_kp]);
        if (sedia.length > 0) return res.status(400).json({ success: false, message: "Anda sudah mendaftar." });

        const sukanDipilihStr = sukan_dipilih ? JSON.stringify(sukan_dipilih) : null;
        await db.query(
            `INSERT INTO penyertaan_acara (acara_id, no_kp, kategori, catatan, sukan_dipilih, jantina) VALUES (?, ?, ?, ?, ?, ?)`,
            [acara_id, no_kp, kategori || null, catatan || null, sukanDipilihStr, jantinaPeserta]
        );

        res.status(201).json({ success: true, message: "Pendaftaran acara berjaya direkodkan!" });
    } catch (error) {
        console.error("Ralat Sertai Acara:", error);
        res.status(500).json({ success: false, message: "Gagal mendaftar acara." });
    }
};

// A3. Ahli batal pendaftaran (sebelum acara)
export const batalSertai = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { acara_id } = req.params;

    try {
        const [hasil] = await db.query(
            `DELETE FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`,
            [acara_id, no_kp]
        );

        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Rekod pendaftaran tidak dijumpai." });
        }

        res.status(200).json({ success: true, message: "Pendaftaran acara anda telah dibatalkan." });
    } catch (error) {
        console.error("Ralat Batal Sertai:", error);
        res.status(500).json({ success: false, message: "Gagal membatalkan pendaftaran." });
    }
};


// =====================================================================
// BAHAGIAN B — ADMIN
// =====================================================================

// B1. Cipta acara baru
export const ciptaAcara = async (req, res) => {
    const {
        nama_acara, jenis_acara, keterangan, lokasi,
        tarikh_acara, tarikh_tamat, tarikh_tutup, emel_urusetia, no_tel_urusetia,
        senarai_sukan, benarkan_pelbagai_sukan, had_peserta, kategori_jantina
    } = req.body;

    let posterString = null;
    if (req.files && req.files.length > 0) {
        const posterArray = req.files.map(file => file.filename);
        posterString = JSON.stringify(posterArray);
    }

    if (!nama_acara || nama_acara.trim() === '') {
        return res.status(400).json({ success: false, message: "Nama acara wajib diisi." });
    }

    const senaraiSukanStr = normalizeSenaraiSukan(senarai_sukan);
    const benarkanPelbagai = normalizeBenarkan(benarkan_pelbagai_sukan);
    const hadPesertaVal = had_peserta && Number(had_peserta) > 0 ? Number(had_peserta) : null;

    try {
        const kategoriJantina = ['Lelaki', 'Perempuan'].includes(kategori_jantina) ? kategori_jantina : 'Semua';

        const [result] = await db.query(`
            INSERT INTO acara
            (nama_acara, jenis_acara, keterangan, lokasi, tarikh_acara, tarikh_tamat, tarikh_tutup, poster, emel_urusetia, no_tel_urusetia, status, senarai_sukan, benarkan_pelbagai_sukan, had_peserta, kategori_jantina)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, ?, ?, ?)
        `, [
            nama_acara, jenis_acara || null, keterangan || null, lokasi || null,
            tarikh_acara || null, tarikh_tamat || null, tarikh_tutup || null, posterString,
            emel_urusetia || null, no_tel_urusetia || null,
            senaraiSukanStr, benarkanPelbagai, hadPesertaVal, kategoriJantina
        ]);

        res.status(201).json({ success: true, message: "Acara berjaya dicipta!", id_acara: result.insertId });
    } catch (error) {
        console.error("Ralat Cipta Acara:", error);
        res.status(500).json({ success: false, message: "Ralat semasa mencipta acara." });
    }
};

// B2. Senarai SEMUA acara (untuk admin) + jumlah peserta
export const senaraiSemuaAcara = async (req, res) => {
    try {
        const [acara] = await db.query(`
            SELECT
                a.*,
                (SELECT COUNT(*) FROM penyertaan_acara p WHERE p.acara_id = a.id) AS jumlah_peserta
            FROM acara a
            ORDER BY a.created_at DESC
        `);
        res.status(200).json({ success: true, data: acara });
    } catch (error) {
        console.error("Ralat Senarai Semua Acara:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai acara." });
    }
};

// B3. Kemaskini acara (termasuk tukar status: AKTIF/TUTUP/SELESAI)
export const kemaskiniAcara = async (req, res) => {
    const { id } = req.params;
    const {
        nama_acara, jenis_acara, keterangan, lokasi,
        tarikh_acara, tarikh_tamat, tarikh_tutup, emel_urusetia, no_tel_urusetia, status,
        senarai_sukan, benarkan_pelbagai_sukan, had_peserta, kategori_jantina
    } = req.body;

    try {
        const fields = [];
        const values = [];

        if (nama_acara !== undefined)      { fields.push('nama_acara = ?');      values.push(nama_acara); }
        if (jenis_acara !== undefined)     { fields.push('jenis_acara = ?');     values.push(jenis_acara || null); }
        if (keterangan !== undefined)      { fields.push('keterangan = ?');      values.push(keterangan || null); }
        if (lokasi !== undefined)          { fields.push('lokasi = ?');          values.push(lokasi || null); }
        if (tarikh_acara !== undefined)    { fields.push('tarikh_acara = ?');    values.push(tarikh_acara || null); }
        if (tarikh_tamat !== undefined)    { fields.push('tarikh_tamat = ?');    values.push(tarikh_tamat || null); }
        if (tarikh_tutup !== undefined)    { fields.push('tarikh_tutup = ?');    values.push(tarikh_tutup || null); }
        if (emel_urusetia !== undefined)   { fields.push('emel_urusetia = ?');   values.push(emel_urusetia || null); }
        if (no_tel_urusetia !== undefined) { fields.push('no_tel_urusetia = ?'); values.push(no_tel_urusetia || null); }
        if (status !== undefined)          { fields.push('status = ?');          values.push(status); }
        if (had_peserta !== undefined) {
            fields.push('had_peserta = ?');
            values.push(had_peserta && Number(had_peserta) > 0 ? Number(had_peserta) : null);
        }

        if (senarai_sukan !== undefined) {
            fields.push('senarai_sukan = ?');
            values.push(normalizeSenaraiSukan(senarai_sukan));
        }
        if (benarkan_pelbagai_sukan !== undefined) {
            fields.push('benarkan_pelbagai_sukan = ?');
            values.push(normalizeBenarkan(benarkan_pelbagai_sukan));
        }
        if (kategori_jantina !== undefined) {
            fields.push('kategori_jantina = ?');
            values.push(['Lelaki', 'Perempuan'].includes(kategori_jantina) ? kategori_jantina : 'Semua');
        }

        if (req.files && req.files.length > 0) {
            const posterArray = req.files.map(f => f.filename);
            fields.push('poster = ?');
            values.push(JSON.stringify(posterArray));
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: "Tiada maklumat untuk dikemas kini." });
        }

        values.push(id);
        await db.query(`UPDATE acara SET ${fields.join(', ')} WHERE id = ?`, values);

        res.status(200).json({ success: true, message: "Acara berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Acara:", error);
        res.status(500).json({ success: false, message: "Gagal mengemas kini acara." });
    }
};

// B4. Senarai peserta bagi satu acara (dengan status is_paid)
export const senaraiPesertaAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [peserta] = await db.query(`
            SELECT
                p.id, p.kategori, p.catatan, p.tarikh_daftar, p.sukan_dipilih,
                COALESCE(p.jantina, u.jantina) AS jantina,
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                u.emel AS email, u.phone AS no_tel, u.no_ahli, u.saiz_baju,
                u.jenis_potongan,
                pt.nama_penempatan AS penempatan,
                p.tarikh_pergi, p.tarikh_balik, p.kaedah_pergerakan,
                p.no_penerbangan_pergi, p.masa_penerbangan_pergi,
                p.no_penerbangan_balik, p.masa_penerbangan_balik,
                ${isPaidSQL} AS is_paid
            FROM penyertaan_acara p
            JOIN users u ON p.no_kp = u.no_kp
            LEFT JOIN penempatan pt ON u.penempatan_id = pt.id
            WHERE p.acara_id = ?
            ORDER BY p.tarikh_daftar ASC
        `, [id]);

        res.status(200).json({ success: true, count: peserta.length, data: peserta });
    } catch (error) {
        console.error("Ralat Senarai Peserta:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai peserta." });
    }
};

// B4b. Padam satu peserta dari acara
export const padamPesertaAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [hasil] = await db.query(`DELETE FROM penyertaan_acara WHERE id = ?`, [id]);
        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Rekod peserta tidak dijumpai.' });
        }
        res.status(200).json({ success: true, message: 'Peserta berjaya dibuang dari acara.' });
    } catch (error) {
        console.error('Ralat Padam Peserta:', error);
        res.status(500).json({ success: false, message: 'Gagal memadam peserta.' });
    }
};

// B4c. Kemaskini maklumat pergerakan peserta
export const kemaskiniPergerakanPeserta = async (req, res) => {
    const { id } = req.params;
    const {
        tarikh_pergi, tarikh_balik, kaedah_pergerakan,
        no_penerbangan_pergi, masa_penerbangan_pergi,
        no_penerbangan_balik, masa_penerbangan_balik
    } = req.body;

    const kaedahSah = ['Darat', 'Bot', 'Penerbangan'];
    const kaedah = kaedahSah.includes(kaedah_pergerakan) ? kaedah_pergerakan : null;

    try {
        const [hasil] = await db.query(`
            UPDATE penyertaan_acara SET
                tarikh_pergi           = ?,
                tarikh_balik           = ?,
                kaedah_pergerakan      = ?,
                no_penerbangan_pergi   = ?,
                masa_penerbangan_pergi = ?,
                no_penerbangan_balik   = ?,
                masa_penerbangan_balik = ?
            WHERE id = ?
        `, [
            tarikh_pergi   || null,
            tarikh_balik   || null,
            kaedah,
            kaedah === 'Penerbangan' ? (no_penerbangan_pergi   || null) : null,
            kaedah === 'Penerbangan' ? (masa_penerbangan_pergi || null) : null,
            kaedah === 'Penerbangan' ? (no_penerbangan_balik   || null) : null,
            kaedah === 'Penerbangan' ? (masa_penerbangan_balik || null) : null,
            id
        ]);
        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Rekod peserta tidak dijumpai.' });
        }
        res.json({ success: true, message: 'Maklumat pergerakan berjaya dikemas kini.' });
    } catch (error) {
        console.error('Ralat Kemaskini Pergerakan:', error);
        res.status(500).json({ success: false, message: 'Gagal mengemaskini maklumat pergerakan.' });
    }
};

// B5. Padam acara (akan padam penyertaan juga melalui ON DELETE CASCADE)
export const padamAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [hasil] = await db.query(`DELETE FROM acara WHERE id = ?`, [id]);
        if (hasil.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });
        }
        res.status(200).json({ success: true, message: "Acara berjaya dipadam." });
    } catch (error) {
        console.error("Ralat Padam Acara:", error);
        res.status(500).json({ success: false, message: "Gagal memadam acara." });
    }
};

// B6. Analisis penyertaan — ringkasan per-sukan + statistik saiz baju + kategori gred
export const analisisAcara = async (req, res) => {
    const { id } = req.params;
    try {
        const [[acara]] = await db.query(
            `SELECT id, nama_acara, jenis_acara, senarai_sukan, tarikh_acara FROM acara WHERE id = ?`, [id]
        );
        if (!acara) return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });

        const [peserta] = await db.query(`
            SELECT
                p.id AS penyertaan_id,
                p.sukan_dipilih,
                p.no_jersi,
                COALESCE(p.jantina, u.jantina) AS jantina,
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred,
                u.saiz_baju, u.no_ahli,
                pt.nama_penempatan AS penempatan
            FROM penyertaan_acara p
            JOIN users u ON p.no_kp = u.no_kp
            LEFT JOIN penempatan pt ON u.penempatan_id = pt.id
            WHERE p.acara_id = ?
            ORDER BY p.id ASC
        `, [id]);

        const isPegawai = (gred) => {
            if (!gred) return false;
            const g = gred.toUpperCase();
            if (g.includes('JUSA') || g.includes('VU') || g.includes('VK')) return true;
            const m = g.match(/^G(\d+)/);
            if (m) return parseInt(m[1]) >= 9;
            return false;
        };

        const safeArr = (v) => {
            if (!v) return [];
            try { return Array.isArray(v) ? v : JSON.parse(v); } catch { return []; }
        };

        const senaraiSukan = safeArr(acara.senarai_sukan);
        const perSukan = {};
        senaraiSukan.forEach(s => {
            perSukan[s] = { sukan: s, jumlah: 0, pegawai: 0, sokongan: 0, peserta: [] };
        });
        perSukan['_umum'] = { sukan: 'Umum / Tanpa Sukan', jumlah: 0, pegawai: 0, sokongan: 0, peserta: [] };

        peserta.forEach(p => {
            const sukan = safeArr(p.sukan_dipilih);
            const kategori = isPegawai(p.gred) ? 'pegawai' : 'sokongan';
            const rekod = {
                penyertaan_id: p.penyertaan_id,
                no_kp: p.no_kp,
                nama_pegawai: p.nama_pegawai,
                jantina: p.jantina || deriveJantina(p.no_kp) || '—',
                gred: p.gred || '—',
                saiz_baju: p.saiz_baju || '—',
                no_ahli: p.no_ahli || '—',
                penempatan: p.penempatan || '—',
                kategori,
                no_jersi_map: typeof p.no_jersi === 'string' ? (() => { try { return JSON.parse(p.no_jersi); } catch { return {}; } })() : (p.no_jersi || {})
            };

            if (sukan.length === 0) {
                perSukan['_umum'].jumlah++;
                perSukan['_umum'][kategori]++;
                perSukan['_umum'].peserta.push({ ...rekod, no_jersi: rekod.no_jersi_map['_umum'] || '' });
            } else {
                sukan.forEach(s => {
                    if (!perSukan[s]) perSukan[s] = { sukan: s, jumlah: 0, pegawai: 0, sokongan: 0, peserta: [] };
                    perSukan[s].jumlah++;
                    perSukan[s][kategori]++;
                    perSukan[s].peserta.push({ ...rekod, no_jersi: rekod.no_jersi_map[s] || '' });
                });
            }
        });

        const saizCount = {};
        peserta.forEach(p => {
            const s = (p.saiz_baju || 'TIADA').toUpperCase();
            saizCount[s] = (saizCount[s] || 0) + 1;
        });
        const susunanSaiz = ['XS','S','M','L','XL','XXL','3XL','4XL','5XL'];
        const statistikSaiz = susunanSaiz.map(s => ({ saiz: s, bilangan: saizCount[s] || 0 }));
        if (saizCount['TIADA']) statistikSaiz.push({ saiz: 'TIADA', bilangan: saizCount['TIADA'] });

        const jumlahPegawai = peserta.filter(p => isPegawai(p.gred)).length;
        const jumlahLelaki = peserta.filter(p => p.jantina === 'Lelaki').length;
        const jumlahPerempuan = peserta.filter(p => p.jantina === 'Perempuan').length;

        res.status(200).json({
            success: true,
            data: {
                acara: { id: acara.id, nama_acara: acara.nama_acara, jenis_acara: acara.jenis_acara, tarikh_acara: acara.tarikh_acara },
                ringkasan: {
                    jumlah_peserta: peserta.length,
                    pegawai: jumlahPegawai,
                    sokongan: peserta.length - jumlahPegawai,
                    lelaki: jumlahLelaki,
                    perempuan: jumlahPerempuan
                },
                per_sukan: Object.values(perSukan).filter(s => s.jumlah > 0),
                statistik_saiz: statistikSaiz
            }
        });
    } catch (error) {
        console.error("Ralat Analisis Acara:", error);
        res.status(500).json({ success: false, message: "Ralat analisis acara." });
    }
};

// B7. Kemaskini nombor jersi peserta untuk sukan tertentu
export const kemaskiniJersi = async (req, res) => {
    const { penyertaan_id, sukan, no_jersi } = req.body;
    if (!penyertaan_id || !sukan) {
        return res.status(400).json({ success: false, message: "penyertaan_id dan sukan wajib." });
    }
    try {
        const [[rekod]] = await db.query(`SELECT no_jersi FROM penyertaan_acara WHERE id = ?`, [penyertaan_id]);
        if (!rekod) return res.status(404).json({ success: false, message: "Rekod tidak dijumpai." });

        let jersiMap = {};
        try { jersiMap = rekod.no_jersi ? JSON.parse(rekod.no_jersi) : {}; } catch {}
        if (no_jersi === '' || no_jersi === null || no_jersi === undefined) {
            delete jersiMap[sukan];
        } else {
            jersiMap[sukan] = String(no_jersi);
        }
        await db.query(`UPDATE penyertaan_acara SET no_jersi = ? WHERE id = ?`, [JSON.stringify(jersiMap), penyertaan_id]);
        res.status(200).json({ success: true, message: "Nombor jersi dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Jersi:", error);
        res.status(500).json({ success: false, message: "Gagal kemaskini nombor jersi." });
    }
};

// B8. Admin tambah peserta secara manual (walaupun belum bayar yuran)
export const tambahPesertaAdmin = async (req, res) => {
    const { acara_id, no_kp, kategori, sukan_dipilih } = req.body;
    if (!acara_id || !no_kp) {
        return res.status(400).json({ success: false, message: "acara_id dan no_kp wajib diisi." });
    }

    try {
        // Semak acara wujud
        const [[acara]] = await db.query(
            `SELECT id, status, had_peserta, (SELECT COUNT(*) FROM penyertaan_acara WHERE acara_id = a.id) AS jumlah_peserta
             FROM acara a WHERE id = ?`, [acara_id]
        );
        if (!acara) return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });

        // Semak ahli wujud
        const [[user]] = await db.query(`SELECT no_kp, nama_pegawai, jantina FROM users WHERE no_kp = ?`, [no_kp]);
        if (!user) return res.status(404).json({ success: false, message: "Ahli tidak dijumpai dalam sistem." });

        // Semak sudah daftar
        const [sedia] = await db.query(`SELECT id FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`, [acara_id, no_kp]);
        if (sedia.length > 0) return res.status(400).json({ success: false, message: `${user.nama_pegawai} telah pun mendaftar acara ini.` });

        const jantinaPeserta = user.jantina || deriveJantina(no_kp);
        const sukanDipilihStr = sukan_dipilih && sukan_dipilih.length > 0 ? JSON.stringify(sukan_dipilih) : null;
        await db.query(
            `INSERT INTO penyertaan_acara (acara_id, no_kp, kategori, sukan_dipilih, jantina) VALUES (?, ?, ?, ?, ?)`,
            [acara_id, no_kp, kategori || null, sukanDipilihStr, jantinaPeserta]
        );

        res.status(201).json({ success: true, message: `${user.nama_pegawai} berjaya didaftarkan.` });
    } catch (error) {
        console.error("Ralat Tambah Peserta Admin:", error);
        res.status(500).json({ success: false, message: "Gagal mendaftarkan peserta." });
    }
};

// B9. Cari ahli untuk admin tambah peserta (carian nama / no_kp)
export const cariAhliUntukAcara = async (req, res) => {
    console.log("=== DEBUG: Start cariAhliUntukAcara ===");
    console.log("Request Query:", req.query);

    const { q, acara_id } = req.query;
    
    if (!q || q.trim().length < 2) {
        console.log("DEBUG: Carian ditolak (kurang dari 2 aksara atau kosong). q =", q);
        return res.status(400).json({ success: false, message: "Sila masukkan sekurang-kurangnya 2 aksara untuk carian." });
    }

    try {
        const kata = `%${q.trim()}%`;
        
        console.log("DEBUG: Kata Carian (kata) =", kata);
        console.log("DEBUG: ID Acara (acara_id) =", acara_id || "Tiada acara_id diberikan");

        // Syarat u.role = 'Ahli' telah dibuang dari query di bawah
        const [ahli] = await db.query(`
            SELECT u.no_kp, u.nama_pegawai, u.no_ahli, u.gred_penyandang_sspa AS gred,
                   pt.nama_penempatan AS penempatan,
                   ${isPaidSQL} AS is_paid,
                   ${acara_id ? 'EXISTS (SELECT 1 FROM penyertaan_acara pa WHERE pa.acara_id = ? AND pa.no_kp = u.no_kp)' : '0'} AS sudah_daftar
            FROM users u
            LEFT JOIN penempatan pt ON u.penempatan_id = pt.id
            WHERE (u.nama_pegawai LIKE ? OR u.no_kp LIKE ? OR u.no_ahli LIKE ?)
            ORDER BY u.nama_pegawai ASC
            LIMIT 20
        `, acara_id ? [acara_id, kata, kata, kata] : [kata, kata, kata]);

        console.log(`DEBUG: Carian Berjaya! Jumlah data dijumpai: ${ahli.length}`);
        
        res.status(200).json({ success: true, data: ahli });
    } catch (error) {
        console.error("=== DEBUG: RALAT Cari Ahli ===");
        console.error(error);
        res.status(500).json({ success: false, message: "Ralat carian ahli." });
    }
};
