import db from '../config/db.js';
import { semakStatusBerbayar } from '../utils/keahlianHelper.js';

// Normalize senarai sukan ke JSON string array (atau null jika kosong).
// Terima: array, JSON string array, satu nilai string, '' / null / undefined.
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

// =====================================================================
// acaraController.js
// Letak di: src/controllers/acaraController.js
//
// BAHAGIAN A: Untuk AHLI  (lihat acara aktif, daftar, batal)
// BAHAGIAN B: Untuk ADMIN (cipta, senarai, kemaskini, peserta, padam)
// =====================================================================


// =====================================================================
// BAHAGIAN A — AHLI
// =====================================================================

// A1. Senarai acara AKTIF + tanda jika ahli ini sudah daftar
export const senaraiAcaraAktif = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [acara] = await db.query(`
            SELECT 
                a.id, a.nama_acara, a.jenis_acara, a.keterangan, a.lokasi,
                a.tarikh_acara, a.tarikh_tutup, a.poster,
                a.emel_urusetia, a.no_tel_urusetia, a.status,
                a.senarai_sukan, a.benarkan_pelbagai_sukan,
                (SELECT COUNT(*) FROM penyertaan_acara p WHERE p.acara_id = a.id) AS jumlah_peserta,
                EXISTS (
                    SELECT 1 FROM penyertaan_acara p2 
                    WHERE p2.acara_id = a.id AND p2.no_kp = ?
                ) AS sudah_daftar
            FROM acara a
            WHERE a.status = 'AKTIF'
            ORDER BY a.tarikh_acara ASC
        `, [no_kp]);

        res.status(200).json({ success: true, data: acara });
    } catch (error) {
        console.error("Ralat Senarai Acara:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai acara." });
    }
};

// A2. Ahli daftar acara
export const sertaiAcara = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { acara_id, kategori, catatan, sukan_dipilih } = req.body; // <-- [TAMBAH sukan_dipilih (sepatutnya array)]

    try {
        // ... (kekalkan semakan status berbayar seperti asal) ...
        const [users] = await db.query(`SELECT jenis_potongan FROM users WHERE no_kp = ?`, [no_kp]);
        const isPaid = await semakStatusBerbayar(no_kp, users[0].jenis_potongan);
        if (!isPaid) return res.status(403).json({ success: false, message: "Sila jelaskan yuran tahunan." });

        // Semak acara wujud, AKTIF & tetapan sukan
        const [acara] = await db.query(
            `SELECT id, status, tarikh_tutup, benarkan_pelbagai_sukan FROM acara WHERE id = ?`, [acara_id]
        );
        if (acara.length === 0) return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });
        if (acara[0].status !== 'AKTIF') return res.status(400).json({ success: false, message: "Pendaftaran ditutup." });

        // Validasi: Jika sukan_dipilih lebih dari 1 tetapi admin tidak benarkan
        if (sukan_dipilih && Array.isArray(sukan_dipilih) && sukan_dipilih.length > 1) {
            if (acara[0].benarkan_pelbagai_sukan === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Maaf, acara ini hanya membenarkan penyertaan untuk SATU sukan sahaja." 
                });
            }
        }

        // ... (kekalkan semakan sudah daftar seperti asal) ...
        const [sedia] = await db.query(`SELECT id FROM penyertaan_acara WHERE acara_id = ? AND no_kp = ?`, [acara_id, no_kp]);
        if (sedia.length > 0) return res.status(400).json({ success: false, message: "Anda sudah mendaftar." });

        // Simpan ke DB
        const sukanDipilihStr = sukan_dipilih ? JSON.stringify(sukan_dipilih) : null;
        await db.query(
            `INSERT INTO penyertaan_acara (acara_id, no_kp, kategori, catatan, sukan_dipilih) VALUES (?, ?, ?, ?, ?)`,
            [acara_id, no_kp, kategori || null, catatan || null, sukanDipilihStr]
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
        tarikh_acara, tarikh_tutup, emel_urusetia, no_tel_urusetia,
        senarai_sukan, benarkan_pelbagai_sukan // <-- [TAMBAHAN BARU]
    } = req.body;

    let posterString = null;
    if (req.files && req.files.length > 0) {
        const posterArray = req.files.map(file => file.filename);
        posterString = JSON.stringify(posterArray);
    }

    if (!nama_acara || nama_acara.trim() === '') {
        return res.status(400).json({ success: false, message: "Nama acara wajib diisi." });
    }

    // Normalize senarai sukan & flag pelbagai
    const senaraiSukanStr = normalizeSenaraiSukan(senarai_sukan);
    const benarkanPelbagai = normalizeBenarkan(benarkan_pelbagai_sukan);

    try {
        const [result] = await db.query(`
            INSERT INTO acara 
            (nama_acara, jenis_acara, keterangan, lokasi, tarikh_acara, tarikh_tutup, poster, emel_urusetia, no_tel_urusetia, status, senarai_sukan, benarkan_pelbagai_sukan)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, ?)
        `, [
            nama_acara, jenis_acara || null, keterangan || null, lokasi || null,
            tarikh_acara || null, tarikh_tutup || null, posterString,
            emel_urusetia || null, no_tel_urusetia || null,
            senaraiSukanStr, benarkanPelbagai
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
        tarikh_acara, tarikh_tutup, emel_urusetia, no_tel_urusetia, status, senarai_sukan, benarkan_pelbagai_sukan
    } = req.body;

    try {
        const fields = [];
        const values = [];

        if (nama_acara !== undefined)      { fields.push('nama_acara = ?');      values.push(nama_acara); }
        if (jenis_acara !== undefined)     { fields.push('jenis_acara = ?');     values.push(jenis_acara || null); }
        if (keterangan !== undefined)      { fields.push('keterangan = ?');      values.push(keterangan || null); }
        if (lokasi !== undefined)          { fields.push('lokasi = ?');          values.push(lokasi || null); }
        if (tarikh_acara !== undefined)    { fields.push('tarikh_acara = ?');    values.push(tarikh_acara || null); }
        if (tarikh_tutup !== undefined)    { fields.push('tarikh_tutup = ?');    values.push(tarikh_tutup || null); }
        if (emel_urusetia !== undefined)   { fields.push('emel_urusetia = ?');   values.push(emel_urusetia || null); }
        if (no_tel_urusetia !== undefined) { fields.push('no_tel_urusetia = ?'); values.push(no_tel_urusetia || null); }
        if (status !== undefined)          { fields.push('status = ?');          values.push(status); }


        if (senarai_sukan !== undefined) {
            fields.push('senarai_sukan = ?');
            values.push(normalizeSenaraiSukan(senarai_sukan));
        }
        if (benarkan_pelbagai_sukan !== undefined) {
            fields.push('benarkan_pelbagai_sukan = ?');
            values.push(normalizeBenarkan(benarkan_pelbagai_sukan));
        }
        
        // Jika ada poster baru dimuat naik (guna array upload, konsisten dengan cipta)
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

// B4. Senarai peserta bagi satu acara
export const senaraiPesertaAcara = async (req, res) => {

    const { id } = req.params;
    try {
        const [peserta] = await db.query(`
            SELECT
                p.id, p.kategori, p.catatan, p.tarikh_daftar, p.sukan_dipilih,
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred_sspa,
                u.emel AS email, u.phone AS no_tel, u.no_ahli, u.saiz_baju, 
                pt.nama_penempatan AS penempatan
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
        // Maklumat acara
        const [[acara]] = await db.query(
            `SELECT id, nama_acara, jenis_acara, senarai_sukan, tarikh_acara FROM acara WHERE id = ?`, [id]
        );
        if (!acara) return res.status(404).json({ success: false, message: "Acara tidak dijumpai." });

        // Semua peserta dengan maklumat lengkap
        const [peserta] = await db.query(`
            SELECT
                p.id AS penyertaan_id,
                p.sukan_dipilih,
                p.no_jersi,
                u.no_kp, u.nama_pegawai, u.gred_penyandang_sspa AS gred,
                u.saiz_baju, u.no_ahli,
                pt.nama_penempatan AS penempatan
            FROM penyertaan_acara p
            JOIN users u ON p.no_kp = u.no_kp
            LEFT JOIN penempatan pt ON u.penempatan_id = pt.id
            WHERE p.acara_id = ?
            ORDER BY p.id ASC
        `, [id]);

        // Klasifikasi gred: Pegawai = G9-G14, JUSA, VU, VK; Sokongan = lain
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

        // Bina ringkasan per sukan
        const senaraiSukan = safeArr(acara.senarai_sukan);
        const perSukan = {};
        senaraiSukan.forEach(s => {
            perSukan[s] = { sukan: s, jumlah: 0, pegawai: 0, sokongan: 0, peserta: [] };
        });

        // Peserta tanpa sukan spesifik (pilih acara umum)
        perSukan['_umum'] = { sukan: 'Umum / Tanpa Sukan', jumlah: 0, pegawai: 0, sokongan: 0, peserta: [] };

        peserta.forEach(p => {
            const sukan = safeArr(p.sukan_dipilih);
            const noJersiMap = safeArr(p.no_jersi) || {};
            const kategori = isPegawai(p.gred) ? 'pegawai' : 'sokongan';
            const rekod = {
                penyertaan_id: p.penyertaan_id,
                no_kp: p.no_kp,
                nama_pegawai: p.nama_pegawai,
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

        // Statistik saiz baju (keseluruhan)
        const saizCount = {};
        peserta.forEach(p => {
            const s = (p.saiz_baju || 'TIADA').toUpperCase();
            saizCount[s] = (saizCount[s] || 0) + 1;
        });
        const susunanSaiz = ['XS','S','M','L','XL','XXL','3XL','4XL','5XL'];
        const statistikSaiz = susunanSaiz.map(s => ({ saiz: s, bilangan: saizCount[s] || 0 }));
        if (saizCount['TIADA']) statistikSaiz.push({ saiz: 'TIADA', bilangan: saizCount['TIADA'] });

        const jumlahPegawai = peserta.filter(p => isPegawai(p.gred)).length;

        res.status(200).json({
            success: true,
            data: {
                acara: { id: acara.id, nama_acara: acara.nama_acara, jenis_acara: acara.jenis_acara, tarikh_acara: acara.tarikh_acara },
                ringkasan: {
                    jumlah_peserta: peserta.length,
                    pegawai: jumlahPegawai,
                    sokongan: peserta.length - jumlahPegawai
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