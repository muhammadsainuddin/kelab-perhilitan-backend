import db from '../config/db.js';
import axios from 'axios';

const TOYYIBPAY_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';
const SECRET_KEY    = process.env.SECRET_KEY    || 'g0jw4dtf-1mgf-l4au-les2-se8kpdg9beoe';
const CATEGORY_CODE = process.env.CATEGORY_CODE || 'v4vftvzw';

// ============================================================
// HELPER: pastikan jadual & kolum wujud (auto-migrate)
// ============================================================
const pastikanJadual = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS produk_kedai (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            nama_produk  VARCHAR(150) NOT NULL,
            deskripsi    TEXT,
            harga        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            stok_semasa  INT NOT NULL DEFAULT 0,
            gambar       VARCHAR(255) DEFAULT NULL,
            gambar_galeri TEXT DEFAULT NULL,
            saiz_tersedia VARCHAR(150) DEFAULT NULL,
            is_percuma   TINYINT(1) NOT NULL DEFAULT 0,
            is_preorder  TINYINT(1) NOT NULL DEFAULT 0,
            tarikh_tutup_preorder DATE DEFAULT NULL,
            is_variasi   TINYINT(1) NOT NULL DEFAULT 0,
            variasi_data TEXT DEFAULT NULL,
            status       ENUM('AKTIF','HABIS') NOT NULL DEFAULT 'AKTIF',
            tarikh_cipta DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Tambah kolum jika jadual lama belum ada (abai error jika dah wujud)
    const kolumBaharu = [
        "ADD COLUMN gambar_galeri TEXT DEFAULT NULL",
        "ADD COLUMN saiz_tersedia VARCHAR(150) DEFAULT NULL",
        "ADD COLUMN is_percuma TINYINT(1) NOT NULL DEFAULT 0",
        "ADD COLUMN is_preorder TINYINT(1) NOT NULL DEFAULT 0",
        "ADD COLUMN tarikh_tutup_preorder DATE DEFAULT NULL",
        "ADD COLUMN is_variasi TINYINT(1) NOT NULL DEFAULT 0",
        "ADD COLUMN variasi_data TEXT DEFAULT NULL"
    ];
    for (const k of kolumBaharu) {
        try { await db.query(`ALTER TABLE produk_kedai ${k}`); } catch (e) { /* kolum dah wujud */ }
    }

    await db.query(`
        CREATE TABLE IF NOT EXISTS pesanan_kedai (
            id                 INT AUTO_INCREMENT PRIMARY KEY,
            no_kp              VARCHAR(20) NOT NULL COLLATE utf8mb4_unicode_ci,
            billCode           VARCHAR(100) DEFAULT NULL,
            jumlah_keseluruhan DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            is_percuma         TINYINT(1) NOT NULL DEFAULT 0,
            status_pesanan     ENUM('PENDING','DIBAYAR','DIPROSES','SELESAI','DIBATALKAN') NOT NULL DEFAULT 'PENDING',
            nota_admin         TEXT DEFAULT NULL,
            tarikh_pesanan     DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try { await db.query("ALTER TABLE pesanan_kedai ADD COLUMN is_percuma TINYINT(1) NOT NULL DEFAULT 0"); } catch(e){}

    await db.query(`
        CREATE TABLE IF NOT EXISTS item_pesanan (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            pesanan_id   INT NOT NULL,
            produk_id    INT NOT NULL,
            kuantiti     INT NOT NULL DEFAULT 1,
            saiz         VARCHAR(150) DEFAULT NULL,
            harga_seunit DECIMAL(10,2) NOT NULL DEFAULT 0.00
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try { await db.query("ALTER TABLE item_pesanan ADD COLUMN saiz VARCHAR(150) DEFAULT NULL"); } catch(e){}
    try { await db.query("ALTER TABLE item_pesanan MODIFY COLUMN saiz VARCHAR(150) DEFAULT NULL"); } catch(e){} // Lebarkan saiz untuk muat teks variasi
};

// ============================================================
// ── ADMIN: PRODUK
// ============================================================
export const senaraiProduk = async (req, res) => {
    try {
        await pastikanJadual();
        const [rows] = await db.query(`
            SELECT id, nama_produk, deskripsi, harga, stok_semasa, gambar, gambar_galeri,
                   saiz_tersedia, is_percuma, is_preorder, tarikh_tutup_preorder, 
                   is_variasi, variasi_data, status,
                   DATE_FORMAT(tarikh_cipta, '%d-%m-%Y') AS tarikh_cipta
            FROM produk_kedai
            ORDER BY tarikh_cipta DESC
        `);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[KEDAI] senaraiProduk:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik senarai produk.' });
    }
};

export const tambahProduk = async (req, res) => {
    try {
        await pastikanJadual();

        const { nama_produk, deskripsi, harga, stok_semasa, saiz_tersedia,
                is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data } = req.body;

        if (!nama_produk) {
            return res.status(400).json({ success: false, message: 'Nama produk wajib diisi.' });
        }

        let gambarUtama = null;
        let galeri = [];
        if (req.files && req.files.length > 0) {
            galeri = req.files.map(f => `/uploads/images/${f.filename}`);
            gambarUtama = galeri[0];
        }

        const percuma  = (is_percuma === 'true' || is_percuma === '1' || is_percuma === true) ? 1 : 0;
        const preorder = (is_preorder === 'true' || is_preorder === '1' || is_preorder === true) ? 1 : 0;
        const variasi  = (is_variasi === 'true' || is_variasi === '1' || is_variasi === true) ? 1 : 0;
        const hargaFinal = percuma ? 0 : (parseFloat(harga) || 0);

        const [result] = await db.query(`
            INSERT INTO produk_kedai
                (nama_produk, deskripsi, harga, stok_semasa, gambar, gambar_galeri,
                 saiz_tersedia, is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nama_produk,
            deskripsi || null,
            hargaFinal,
            parseInt(stok_semasa) || 0,
            gambarUtama,
            galeri.length ? JSON.stringify(galeri) : null,
            saiz_tersedia || null,
            percuma,
            preorder,
            tarikh_tutup_preorder || null,
            variasi,
            variasi ? (variasi_data || null) : null
        ]);

        return res.status(201).json({ success: true, message: 'Produk berjaya ditambah.', id: result.insertId });
    } catch (err) {
        console.error('[KEDAI] tambahProduk:', err.message);
        return res.status(500).json({ success: false, message: 'Ralat menyimpan produk: ' + err.message });
    }
};

export const kemaskiniProduk = async (req, res) => {
    try {
        await pastikanJadual();
        const { id } = req.params;
        const { nama_produk, deskripsi, harga, stok_semasa, status, saiz_tersedia,
                is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data } = req.body;

        const fields = [];
        const vals   = [];

        if (nama_produk !== undefined) { fields.push('nama_produk = ?'); vals.push(nama_produk); }
        if (deskripsi   !== undefined) { fields.push('deskripsi = ?');   vals.push(deskripsi); }
        if (stok_semasa !== undefined) { fields.push('stok_semasa = ?'); vals.push(parseInt(stok_semasa)); }
        if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
        if (saiz_tersedia !== undefined) { fields.push('saiz_tersedia = ?'); vals.push(saiz_tersedia || null); }
        if (tarikh_tutup_preorder !== undefined) { fields.push('tarikh_tutup_preorder = ?'); vals.push(tarikh_tutup_preorder || null); }
        if (variasi_data !== undefined) { fields.push('variasi_data = ?'); vals.push(variasi_data || null); }

        if (is_percuma !== undefined) {
            const percuma = (is_percuma === 'true' || is_percuma === '1' || is_percuma === true) ? 1 : 0;
            fields.push('is_percuma = ?'); vals.push(percuma);
            if (percuma) { fields.push('harga = ?'); vals.push(0); }
            else if (harga !== undefined) { fields.push('harga = ?'); vals.push(parseFloat(harga) || 0); }
        } else if (harga !== undefined) {
            fields.push('harga = ?'); vals.push(parseFloat(harga) || 0);
        }

        if (is_preorder !== undefined) {
            const preorder = (is_preorder === 'true' || is_preorder === '1' || is_preorder === true) ? 1 : 0;
            fields.push('is_preorder = ?'); vals.push(preorder);
        }

        if (is_variasi !== undefined) {
            const variasi = (is_variasi === 'true' || is_variasi === '1' || is_variasi === true) ? 1 : 0;
            fields.push('is_variasi = ?'); vals.push(variasi);
        }

        if (req.files && req.files.length > 0) {
            const galeri = req.files.map(f => `/uploads/images/${f.filename}`);
            fields.push('gambar = ?');        vals.push(galeri[0]);
            fields.push('gambar_galeri = ?'); vals.push(JSON.stringify(galeri));
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Tiada data untuk dikemaskini.' });
        }

        vals.push(id);
        await db.query(`UPDATE produk_kedai SET ${fields.join(', ')} WHERE id = ?`, vals);
        return res.status(200).json({ success: true, message: 'Produk berjaya dikemas kini.' });
    } catch (err) {
        console.error('[KEDAI] kemaskiniProduk:', err.message);
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini produk: ' + err.message });
    }
};

export const padamProduk = async (req, res) => {
    try {
        await db.query('DELETE FROM produk_kedai WHERE id = ?', [req.params.id]);
        return res.status(200).json({ success: true, message: 'Produk berjaya dipadam.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat memadam produk.' });
    }
};

// ============================================================
// ── AHLI: senarai produk aktif
// ============================================================
export const senaraiProdukAktif = async (req, res) => {
    try {
        await pastikanJadual();
        const [rows] = await db.query(`
            SELECT id, nama_produk, deskripsi, harga, stok_semasa, gambar, gambar_galeri,
                   saiz_tersedia, is_percuma, is_preorder, tarikh_tutup_preorder, 
                   is_variasi, variasi_data, status
            FROM produk_kedai
            WHERE status = 'AKTIF'
            ORDER BY tarikh_cipta DESC
        `);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[KEDAI] senaraiProdukAktif:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik produk.' });
    }
};

// ============================================================
// ── ADMIN: PESANAN
// ============================================================
export const senaraiPesanan = async (req, res) => {
    try {
        await pastikanJadual();
        const [pesanan] = await db.query(`
            SELECT p.id, p.no_kp, u.nama_pegawai AS nama_ahli,
                   p.billCode, p.jumlah_keseluruhan, p.is_percuma, p.status_pesanan, p.nota_admin,
                   DATE_FORMAT(p.tarikh_pesanan, '%d-%m-%Y %H:%i') AS tarikh_pesanan
            FROM pesanan_kedai p
            LEFT JOIN users u 
                ON CONVERT(p.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            ORDER BY p.tarikh_pesanan DESC
        `);
        for (const p of pesanan) {
            const [items] = await db.query(`
                SELECT i.kuantiti, i.saiz, i.harga_seunit, pr.nama_produk, pr.gambar
                FROM item_pesanan i
                JOIN produk_kedai pr ON i.produk_id = pr.id
                WHERE i.pesanan_id = ?
            `, [p.id]);
            p.items = items;
        }
        return res.status(200).json({ success: true, data: pesanan });
    } catch (err) {
        console.error('[KEDAI] senaraiPesanan:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik senarai pesanan.' });
    }
};

export const kemaskiniStatusPesanan = async (req, res) => {
    const { id } = req.params;
    const { status_pesanan, nota_admin } = req.body;
    const sah = ['PENDING','DIBAYAR','DIPROSES','SELESAI','DIBATALKAN'];
    if (!sah.includes(status_pesanan)) {
        return res.status(400).json({ success: false, message: 'Status tidak sah.' });
    }
    try {
        await db.query('UPDATE pesanan_kedai SET status_pesanan = ?, nota_admin = ? WHERE id = ?',
            [status_pesanan, nota_admin || null, id]);
        return res.status(200).json({ success: true, message: `Status dikemas kini kepada ${status_pesanan}.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini status.' });
    }
};

// ============================================================
// ── AHLI: BUAT PESANAN
//    Body: { items: [{ produk_id, kuantiti, saiz }] }
// ============================================================
export const buatPesanan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Sila pilih produk.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        let jumlah = 0;
        let adaPercuma = false;
        const diproses = [];

        for (const item of items) {
            const [[prod]] = await conn.query(
                'SELECT * FROM produk_kedai WHERE id = ? FOR UPDATE', [item.produk_id]);

            if (!prod) throw new Error(`Produk tidak wujud.`);
            if (prod.status !== 'AKTIF') throw new Error(`"${prod.nama_produk}" tidak dijual.`);
            
            let hargaSeunit = parseFloat(prod.harga);

            // LOGIK PEMILIHAN VARIASI DAN SEMAKAN STOK
            if (prod.is_variasi) {
                let vData = [];
                try { vData = JSON.parse(prod.variasi_data || '[]'); } catch(e){}
                
                const chosenVar = vData.find(v => v.nama === item.saiz); // item.saiz pegang nama variasi
                if (!chosenVar) throw new Error(`Pilihan "${item.saiz}" tidak sah untuk produk ini.`);
                if (parseInt(chosenVar.stok) < item.kuantiti) throw new Error(`Stok variasi "${item.saiz}" tidak mencukupi.`);
                
                hargaSeunit = parseFloat(chosenVar.harga);
            } else {
                if (prod.stok_semasa < item.kuantiti) throw new Error(`Stok "${prod.nama_produk}" tidak cukup.`);
            }

            // LOGIK ITEM PERCUMA
            if (prod.is_percuma) {
                adaPercuma = true;
                if (item.kuantiti > 1) throw new Error(`"${prod.nama_produk}" percuma — had 1 unit sahaja.`);

                const [[{ bil }]] = await conn.query(`
                    SELECT COUNT(*) AS bil FROM pesanan_kedai pk
                    JOIN item_pesanan ip ON ip.pesanan_id = pk.id
                    WHERE pk.no_kp = ? AND ip.produk_id = ? 
                    AND pk.status_pesanan NOT IN ('DIBATALKAN')
                `, [no_kp, prod.id]);
                
                if (bil > 0) throw new Error(`Anda telah menempah "${prod.nama_produk}" sebelum ini (had 1 per ahli).`);
            }

            jumlah += (prod.is_percuma ? 0 : hargaSeunit * item.kuantiti);
            diproses.push({ ...prod, kuantiti: item.kuantiti, saiz: item.saiz || null, hargaFinal: hargaSeunit });
        }

        const [pRes] = await conn.query(
            'INSERT INTO pesanan_kedai (no_kp, jumlah_keseluruhan, is_percuma) VALUES (?, ?, ?)',
            [no_kp, jumlah, adaPercuma ? 1 : 0]);
        const pesananId = pRes.insertId;

        for (const it of diproses) {
            await conn.query(
                'INSERT INTO item_pesanan (pesanan_id, produk_id, kuantiti, saiz, harga_seunit) VALUES (?, ?, ?, ?, ?)',
                [pesananId, it.id, it.kuantiti, it.saiz, it.is_percuma ? 0 : it.hargaFinal]);
        }

        // ── Jika SEMUA percuma (jumlah=0): terus SELESAI, tolak stok, tiada FPX ──
        if (jumlah <= 0) {
            await conn.query('UPDATE pesanan_kedai SET status_pesanan = "DIPROSES" WHERE id = ?', [pesananId]);
            for (const it of diproses) {
                if (it.is_variasi) {
                    let vData = [];
                    try { vData = JSON.parse(it.variasi_data || '[]'); } catch(e){}
                    let allZero = true;
                    vData = vData.map(v => {
                        if (v.nama === it.saiz) v.stok = Math.max(0, parseInt(v.stok) - it.kuantiti);
                        if (parseInt(v.stok) > 0) allZero = false;
                        return v;
                    });
                    await conn.query('UPDATE produk_kedai SET variasi_data = ?, status = ? WHERE id = ?', 
                        [JSON.stringify(vData), allZero ? 'HABIS' : 'AKTIF', it.id]);
                } else {
                    await conn.query('UPDATE produk_kedai SET stok_semasa = GREATEST(0, stok_semasa - ?) WHERE id = ?', [it.kuantiti, it.id]);
                    await conn.query('UPDATE produk_kedai SET status = "HABIS" WHERE id = ? AND stok_semasa = 0', [it.id]);
                }
            }
            await conn.commit();
            return res.status(201).json({
                success: true, percuma: true, pesanan_id: pesananId,
                message: 'Tempahan percuma berjaya direkodkan! Sila tunggu pengesahan admin.'
            });
        }

        // ── Ada bayaran: cipta bil FPX ──
        const [[ahli]] = await conn.query('SELECT nama_pegawai, emel, phone FROM users WHERE no_kp = ?', [no_kp]);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const backendUrl  = process.env.BACKEND_URL  || 'http://localhost:5001';

        const formData = new URLSearchParams({
            userSecretKey: SECRET_KEY,
            categoryCode:  CATEGORY_CODE,
            billName:      `Pesanan#${pesananId}`,
            billDescription: `Pesanan Kedai #${pesananId} - Kelab Perhilitan`,
            billPriceSetting: 1,
            billPayorInfo:    1,
            billAmount:       Math.round(jumlah * 100),
            billReturnUrl:    `${frontendUrl}/dashboard/kedai`,
            billCallbackUrl:  `${backendUrl}/api/kedai/webhook/${pesananId}`,
            billExternalReferenceNo: `KEDAI-${pesananId}`,
            billTo:    ahli?.nama_pegawai || '',
            billEmail: ahli?.emel || 'kelabperhilitan@gmail.com',
            billPhone: ahli?.phone || '0123456789',
            billSplitPayment: 0,
            billPaymentChannel: 0,
        });

        const fpxRes = await axios.post(TOYYIBPAY_URL, formData.toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const billCode = fpxRes.data[0]?.BillCode;
        if (!billCode) throw new Error('Gagal mendapat BillCode dari ToyyibPay.');

        await conn.query('UPDATE pesanan_kedai SET billCode = ? WHERE id = ?', [billCode, pesananId]);
        await conn.commit();

        return res.status(201).json({
            success: true, percuma: false, pesanan_id: pesananId, billCode,
            url_bayar: `https://dev.toyyibpay.com/${billCode}`
        });

    } catch (err) {
        await conn.rollback();
        console.error('[KEDAI] buatPesanan:', err.message);
        return res.status(500).json({ success: false, message: err.message || 'Ralat membuat pesanan.' });
    } finally {
        conn.release();
    }
};

// ============================================================
// ── WEBHOOK ToyyibPay
// ============================================================
export const webhookKedai = async (req, res) => {
    const { pesananId } = req.params;
    const { status_id, billcode } = req.body;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [[pesanan]] = await conn.query('SELECT * FROM pesanan_kedai WHERE id = ? FOR UPDATE', [pesananId]);
        if (!pesanan) { await conn.rollback(); return res.status(404).send('Tidak dijumpai.'); }

        if (['DIBAYAR','DIPROSES','SELESAI'].includes(pesanan.status_pesanan)) {
            await conn.rollback(); return res.status(200).send('OK');
        }

        if (status_id == '1') {
            await conn.query('UPDATE pesanan_kedai SET status_pesanan = "DIBAYAR" WHERE id = ?', [pesananId]);
            const [items] = await conn.query('SELECT produk_id, kuantiti, saiz FROM item_pesanan WHERE pesanan_id = ?', [pesananId]);
            
            for (const it of items) {
                const [[prod]] = await conn.query('SELECT id, is_variasi, variasi_data, stok_semasa FROM produk_kedai WHERE id = ? FOR UPDATE', [it.produk_id]);
                if (!prod) continue;

                if (prod.is_variasi) {
                    let vData = [];
                    try { vData = JSON.parse(prod.variasi_data || '[]'); } catch(e){}
                    let allZero = true;
                    vData = vData.map(v => {
                        if (v.nama === it.saiz) v.stok = Math.max(0, parseInt(v.stok) - it.kuantiti);
                        if (parseInt(v.stok) > 0) allZero = false;
                        return v;
                    });
                    await conn.query('UPDATE produk_kedai SET variasi_data = ?, status = ? WHERE id = ?', 
                        [JSON.stringify(vData), allZero ? 'HABIS' : 'AKTIF', prod.id]);
                } else {
                    await conn.query('UPDATE produk_kedai SET stok_semasa = GREATEST(0, stok_semasa - ?) WHERE id = ?', [it.kuantiti, prod.id]);
                    await conn.query('UPDATE produk_kedai SET status = "HABIS" WHERE id = ? AND stok_semasa = 0', [prod.id]);
                }
            }

            try {
                await conn.query(`
                    INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak)
                    VALUES ('MASUK','KEDAI',?,?,?,?)
                `, [pesanan.jumlah_keseluruhan, billcode || pesanan.billCode,
                    `Jualan Kedai — Pesanan #${pesananId}`, pesanan.no_kp]);
            } catch(e) { }
            await conn.commit();
            return res.status(200).send('OK');
        } else {
            await conn.query('UPDATE pesanan_kedai SET status_pesanan = "DIBATALKAN" WHERE id = ?', [pesananId]);
            await conn.commit();
            return res.status(200).send('OK');
        }
    } catch (err) {
        await conn.rollback();
        console.error('[KEDAI] webhook:', err.message);
        return res.status(500).send('Ralat webhook.');
    } finally {
        conn.release();
    }
};

export const semakPesanan = async (req, res) => {
    try {
        const [[p]] = await db.query(
            'SELECT id, status_pesanan, jumlah_keseluruhan FROM pesanan_kedai WHERE id = ? AND no_kp = ?',
            [req.params.pesananId, req.user.no_kp]);
        if (!p) return res.status(404).json({ success: false, message: 'Tidak dijumpai.' });
        return res.status(200).json({ success: true, data: p });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat menyemak.' });
    }
};