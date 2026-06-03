import db from '../config/db.js';
import { janaBilFPX, semakTransaksiBil } from '../utils/toyyibpay.js';
import { prosesKedaiBerjaya } from '../utils/paymentSync.js';

// Migrasi DB — jalankan sekali semasa server mula
(async () => {
    try {
        const [cols] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produk_kedai' AND COLUMN_NAME = 'harga_modal'
        `);
        if (cols.length === 0) {
            await db.query(`ALTER TABLE produk_kedai ADD COLUMN harga_modal DECIMAL(10,2) DEFAULT NULL AFTER harga`);
        }
        const [colPj] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produk_kedai' AND COLUMN_NAME = 'penjual_id'
        `);
        if (colPj.length === 0) {
            await db.query(`ALTER TABLE produk_kedai ADD COLUMN penjual_id INT DEFAULT NULL AFTER harga_modal`);
        }
        await db.query(`
            CREATE TABLE IF NOT EXISTS penjual_kedai (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                no_kp         VARCHAR(20)  NOT NULL,
                nama_perniagaan VARCHAR(200) NOT NULL,
                jenis_produk  VARCHAR(200),
                telefon       VARCHAR(20),
                deskripsi     TEXT,
                status        ENUM('PENDING','AKTIF','DITOLAK') DEFAULT 'PENDING',
                nota_admin    TEXT,
                tarikh_daftar DATETIME DEFAULT CURRENT_TIMESTAMP,
                tarikh_kemaskini DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Pastikan kolum kategori dalam transaksi_kewangan ada semua nilai yang diperlukan
        const [[colKat]] = await db.query(`
            SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaksi_kewangan' AND COLUMN_NAME = 'kategori'
        `);
        if (colKat && !colKat.COLUMN_TYPE.includes("'BELIAN_BARANG'")) {
            await db.query(`
                ALTER TABLE transaksi_kewangan
                MODIFY COLUMN kategori ENUM('YURAN','KEDAI','KEBAJIKAN','SUMBANGAN','OPERASI','BELIAN_BARANG','PERKHIDMATAN','ACARA','LAIN-LAIN')
            `);
        }

        // Kolum penghantaran untuk pesanan_kedai
        const migrasiFail = [
            `ALTER TABLE pesanan_kedai ADD COLUMN IF NOT EXISTS kaedah_penghantaran ENUM('PTJ','POS') DEFAULT 'PTJ'`,
            `ALTER TABLE pesanan_kedai ADD COLUMN IF NOT EXISTS alamat_penghantaran TEXT DEFAULT NULL`,
            `ALTER TABLE pesanan_kedai ADD COLUMN IF NOT EXISTS kos_postage DECIMAL(10,2) DEFAULT 0.00`,
            // Kolum untuk produk milik penjual
            `ALTER TABLE produk_kedai ADD COLUMN IF NOT EXISTS nota_tolak TEXT DEFAULT NULL`,
        ];
        for (const sql of migrasiFail) {
            try { await db.query(sql); } catch(e) {}
        }

        // Pastikan status produk_kedai ada nilai SEMAK dan DITOLAK
        try {
            await db.query(`
                ALTER TABLE produk_kedai
                MODIFY COLUMN status ENUM('AKTIF','HABIS','SEMAK','DITOLAK') DEFAULT 'AKTIF'
            `);
        } catch(e) {}
    } catch (e) {
        console.error('[KEDAI] Migrasi DB:', e.message);
    }
})();

// ============================================================
// ── ADMIN: PENGURUSAN PRODUK
// ============================================================
export const senaraiProduk = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, nama_produk, deskripsi, harga, harga_modal, penjual_id, stok_semasa,
                   gambar, gambar_galeri, saiz_tersedia, is_percuma, is_preorder,
                   tarikh_tutup_preorder, is_variasi, variasi_data, status,
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
        const { nama_produk, deskripsi, harga, harga_modal, stok_semasa, saiz_tersedia,
                is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data, penjual_id } = req.body;

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
                (nama_produk, deskripsi, harga, harga_modal, penjual_id, stok_semasa, gambar, gambar_galeri,
                 saiz_tersedia, is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            nama_produk,
            deskripsi || null,
            hargaFinal,
            percuma ? null : (parseFloat(harga_modal) || null),
            penjual_id ? parseInt(penjual_id) : null,
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
        const { id } = req.params;
        const { nama_produk, deskripsi, harga, harga_modal, stok_semasa, status, saiz_tersedia,
                is_percuma, is_preorder, tarikh_tutup_preorder, is_variasi, variasi_data, penjual_id } = req.body;

        const fields = [];
        const vals   = [];

        if (nama_produk !== undefined) { fields.push('nama_produk = ?'); vals.push(nama_produk); }
        if (deskripsi   !== undefined) { fields.push('deskripsi = ?');   vals.push(deskripsi); }
        if (stok_semasa !== undefined) { fields.push('stok_semasa = ?'); vals.push(parseInt(stok_semasa)); }
        if (status      !== undefined) { fields.push('status = ?');      vals.push(status); }
        if (saiz_tersedia !== undefined) { fields.push('saiz_tersedia = ?'); vals.push(saiz_tersedia || null); }
        if (tarikh_tutup_preorder !== undefined) { fields.push('tarikh_tutup_preorder = ?'); vals.push(tarikh_tutup_preorder || null); }
        if (variasi_data !== undefined) { fields.push('variasi_data = ?'); vals.push(variasi_data || null); }
        if (harga_modal !== undefined) { fields.push('harga_modal = ?'); vals.push(harga_modal ? parseFloat(harga_modal) : null); }
        if (penjual_id !== undefined) { fields.push('penjual_id = ?'); vals.push(penjual_id ? parseInt(penjual_id) : null); }

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
// ── AHLI: SENARAI PRODUK AKTIF (UNTUK DIPAPARKAN DI KEDAI)
// ============================================================
export const senaraiProdukAktif = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, nama_produk, deskripsi, harga, harga_modal, penjual_id, stok_semasa, gambar, gambar_galeri,
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
// ── ADMIN: PENGURUSAN PESANAN AHLI
// ============================================================
export const senaraiPesanan = async (req, res) => {
    try {
        const [pesanan] = await db.query(`
            SELECT p.id, p.no_kp, u.nama_pegawai AS nama_ahli,
                   u.phone AS no_tel, pen.nama_penempatan AS ptj,
                   p.billCode, p.jumlah_keseluruhan, p.is_percuma, p.status_pesanan, p.nota_admin,
                   p.kaedah_penghantaran, p.alamat_penghantaran, p.kos_postage,
                   DATE_FORMAT(p.tarikh_pesanan, '%d-%m-%Y %H:%i') AS tarikh_pesanan
            FROM pesanan_kedai p
            LEFT JOIN users u
                ON CONVERT(p.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 = CONVERT(u.no_kp USING utf8mb4) COLLATE utf8mb4_unicode_ci
            LEFT JOIN penempatan pen ON u.penempatan_id = pen.id
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
// ── AHLI: BUAT PESANAN (Bayar melalui FPX atau Terus Selesai)
//    Body format: { items: [{ produk_id, kuantiti, saiz }] }
// ============================================================
export const buatPesanan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { items, kaedah_penghantaran, alamat_penghantaran, kos_postage } = req.body;

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
            const [[prod]] = await conn.query('SELECT * FROM produk_kedai WHERE id = ? FOR UPDATE', [item.produk_id]);
            if (!prod) throw new Error(`Produk tidak wujud.`);
            if (prod.status !== 'AKTIF') throw new Error(`"${prod.nama_produk}" tidak dijual.`);
            
            let hargaSeunit = parseFloat(prod.harga);

            // LOGIK PEMILIHAN VARIASI DAN SEMAKAN STOK
            if (prod.is_variasi) {
                let vData = [];
                try { vData = JSON.parse(prod.variasi_data || '[]'); } catch(e){}
                const chosenVar = vData.find(v => v.nama === item.saiz);
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
                    WHERE pk.no_kp = ? AND ip.produk_id = ? AND pk.status_pesanan NOT IN ('DIBATALKAN')
                `, [no_kp, prod.id]);
                
                if (bil > 0) throw new Error(`Anda telah menempah "${prod.nama_produk}" sebelum ini (had 1 per ahli).`);
            }

            jumlah += (prod.is_percuma ? 0 : hargaSeunit * item.kuantiti);
            diproses.push({ ...prod, kuantiti: item.kuantiti, saiz: item.saiz || null, hargaFinal: hargaSeunit });
        }

        const kos_pos = adaPercuma ? 0 : (parseFloat(kos_postage) || 0);
        const jumlahTotal = jumlah + kos_pos;
        const kaedah = kaedah_penghantaran === 'POS' ? 'POS' : 'PTJ';
        const alamat  = (kaedah === 'POS' && alamat_penghantaran) ? alamat_penghantaran.trim() : null;

        const [pRes] = await conn.query(
            'INSERT INTO pesanan_kedai (no_kp, jumlah_keseluruhan, is_percuma, kaedah_penghantaran, alamat_penghantaran, kos_postage) VALUES (?, ?, ?, ?, ?, ?)',
            [no_kp, jumlahTotal, adaPercuma ? 1 : 0, kaedah, alamat, kos_pos]
        );
        const pesananId = pRes.insertId;

        for (const it of diproses) {
            await conn.query('INSERT INTO item_pesanan (pesanan_id, produk_id, kuantiti, saiz, harga_seunit) VALUES (?, ?, ?, ?, ?)', [pesananId, it.id, it.kuantiti, it.saiz, it.is_percuma ? 0 : it.hargaFinal]);
        }

        // ── Tempahan Percuma Sepenuhnya (Tiada FPX, terus DIPROSES) ──
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
                    await conn.query('UPDATE produk_kedai SET variasi_data = ?, status = ? WHERE id = ?', [JSON.stringify(vData), allZero ? 'HABIS' : 'AKTIF', it.id]);
                } else {
                    await conn.query('UPDATE produk_kedai SET stok_semasa = GREATEST(0, stok_semasa - ?) WHERE id = ?', [it.kuantiti, it.id]);
                    await conn.query('UPDATE produk_kedai SET status = "HABIS" WHERE id = ? AND stok_semasa = 0', [it.id]);
                }
            }
            await conn.commit();
            return res.status(201).json({ success: true, percuma: true, pesanan_id: pesananId, message: 'Tempahan percuma berjaya direkodkan! Sila tunggu pengesahan admin.' });
        }

        // ── PANGGIL MODUL PUSAT TOYYIBPAY ──
        const [[ahli]] = await conn.query('SELECT nama_pegawai, emel, phone FROM users WHERE no_kp = ?', [no_kp]);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const backendUrl  = process.env.BACKEND_URL  || 'http://localhost:5001';

        const fpxData = await janaBilFPX({
            keterangan: `Pesanan Kedai #${pesananId} - Kelab Perhilitan`,
            amaun: jumlahTotal,
            returnUrl: `${frontendUrl}/dashboard/kedai`,
            callbackUrl: `${backendUrl}/api/kedai/webhook/${pesananId}`,
            referenceNo: `KEDAI-${pesananId}`,
            user: ahli || {},
            jenis: 'KEDAI'
        });

        await conn.query('UPDATE pesanan_kedai SET billCode = ? WHERE id = ?', [fpxData.billCode, pesananId]);
        await conn.commit();

        return res.status(201).json({ success: true, percuma: false, pesanan_id: pesananId, billCode: fpxData.billCode, url_bayar: fpxData.billUrl });

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
    const { billcode } = req.body;

    try {
        const [[pesanan]] = await db.query('SELECT billCode, status_pesanan FROM pesanan_kedai WHERE id = ?', [pesananId]);
        if (!pesanan) return res.status(404).send('Tidak dijumpai.');

        // Sudah diproses — balas OK tanpa buat apa-apa (idempotent)
        if (['DIBAYAR', 'DIPROSES', 'SELESAI'].includes(pesanan.status_pesanan)) {
            return res.status(200).send('OK');
        }

        // PENTING: Jangan percaya status_id dari body callback (boleh dipalsukan).
        // Sahkan status sebenar terus dengan pelayan ToyyibPay.
        const kod = pesanan.billCode || billcode;
        const status = await semakTransaksiBil(kod);

        if (status === 'BERJAYA') {
            // Logik tolak stok + rekod kewangan (transaksi atomik) di utils/paymentSync.js
            await prosesKedaiBerjaya(pesananId);
        } else if (status === 'GAGAL') {
            await db.query('UPDATE pesanan_kedai SET status_pesanan = "DIBATALKAN" WHERE id = ? AND status_pesanan = "PENDING"', [pesananId]);
        }
        // status PENDING: biarkan kekal PENDING.

        return res.status(200).send('OK');
    } catch (err) {
        console.error('[KEDAI] webhook:', err.message);
        return res.status(500).send('Ralat webhook.');
    }
};

// ============================================================
// ── SEMAK STATUS PESANAN (Untuk Paparan Ahli)
// ============================================================
export const semakPesanan = async (req, res) => {
    try {
        const [[p]] = await db.query(
            'SELECT id, status_pesanan, jumlah_keseluruhan FROM pesanan_kedai WHERE id = ? AND no_kp = ?',
            [req.params.pesananId, req.user.no_kp]);
        if (!p) return res.status(404).json({ success: false, message: 'Tidak dijumpai.' });
        return res.status(200).json({ success: true, data: p });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat menyemak pesanan.' });
    }
};

// ============================================================
// ── PENJUAL: DAFTAR JUAL (Ahli submit permohonan)
// ============================================================
export const daftarPenjual = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { nama_perniagaan, jenis_produk, telefon, deskripsi } = req.body;
    if (!nama_perniagaan) return res.status(400).json({ success: false, message: 'Nama perniagaan wajib diisi.' });
    try {
        const [[sedia]] = await db.query('SELECT id, status FROM penjual_kedai WHERE no_kp = ?', [no_kp]);
        if (sedia) {
            if (sedia.status === 'AKTIF') return res.status(400).json({ success: false, message: 'Akaun penjual anda sudah aktif.' });
            if (sedia.status === 'PENDING') return res.status(400).json({ success: false, message: 'Permohonan anda sedang dalam semakan.' });
            // DITOLAK — boleh daftar semula
            await db.query(`UPDATE penjual_kedai SET nama_perniagaan=?,jenis_produk=?,telefon=?,deskripsi=?,status='PENDING',nota_admin=NULL WHERE id=?`,
                [nama_perniagaan, jenis_produk||null, telefon||null, deskripsi||null, sedia.id]);
            return res.status(200).json({ success: true, message: 'Permohonan semula berjaya dihantar.' });
        }
        await db.query(`INSERT INTO penjual_kedai (no_kp, nama_perniagaan, jenis_produk, telefon, deskripsi) VALUES (?,?,?,?,?)`,
            [no_kp, nama_perniagaan, jenis_produk||null, telefon||null, deskripsi||null]);
        return res.status(201).json({ success: true, message: 'Permohonan berjaya dihantar. Sila tunggu pengesahan admin.' });
    } catch (err) {
        console.error('[PENJUAL] daftarPenjual:', err.message);
        return res.status(500).json({ success: false, message: 'Ralat mendaftar penjual.' });
    }
};

// ── ADMIN: Senarai semua penjual berdaftar ──
export const senaraiPenjual = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.id, p.no_kp, p.nama_perniagaan, p.jenis_produk, p.telefon, p.deskripsi,
                   p.status, p.nota_admin,
                   DATE_FORMAT(p.tarikh_daftar, '%d-%m-%Y %H:%i') AS tarikh_daftar,
                   DATE_FORMAT(p.tarikh_kemaskini, '%d-%m-%Y %H:%i') AS tarikh_kemaskini,
                   u.nama_pegawai, u.emel,
                   pen.nama_penempatan AS ptj,
                   (SELECT COUNT(*) FROM produk_kedai pk WHERE pk.penjual_id = p.id AND pk.status = 'AKTIF') AS bil_produk
            FROM penjual_kedai p
            LEFT JOIN users u ON p.no_kp = u.no_kp
            LEFT JOIN penempatan pen ON u.penempatan_id = pen.id
            ORDER BY FIELD(p.status,'PENDING','AKTIF','DITOLAK'), p.tarikh_daftar DESC
        `);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        console.error('[PENJUAL] senaraiPenjual:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik senarai penjual.' });
    }
};

// ── ADMIN: Aktifkan / Tolak penjual ──
export const kemaskiniStatusPenjual = async (req, res) => {
    const { id } = req.params;
    const { status, nota_admin } = req.body;
    if (!['AKTIF','DITOLAK','PENDING'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status tidak sah.' });
    }
    try {
        await db.query('UPDATE penjual_kedai SET status = ?, nota_admin = ? WHERE id = ?', [status, nota_admin || null, id]);
        return res.status(200).json({ success: true, message: `Status penjual dikemaskini kepada ${status}.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat mengemaskini status penjual.' });
    }
};

// ── AHLI: Semak status permohonan penjual sendiri ──
export const semakStatusPenjual = async (req, res) => {
    try {
        const [[row]] = await db.query(
            'SELECT id, status, nota_admin, tarikh_daftar FROM penjual_kedai WHERE no_kp = ?',
            [req.user.no_kp]
        );
        return res.status(200).json({ success: true, data: row || null });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Ralat menyemak status.' });
    }
};

// ============================================================
// ── PENJUAL: URUS PRODUK SENDIRI
// ============================================================

// Penjual lihat produk mereka sendiri
export const senaraiProdukPenjual = async (req, res) => {
    try {
        const [[penjual]] = await db.query('SELECT id FROM penjual_kedai WHERE no_kp = ? AND status = "AKTIF"', [req.user.no_kp]);
        if (!penjual) return res.status(403).json({ success: false, message: 'Akaun penjual tidak aktif.' });

        const [rows] = await db.query(`
            SELECT id, nama_produk, deskripsi, harga, stok_semasa, gambar,
                   saiz_tersedia, status, nota_tolak,
                   DATE_FORMAT(tarikh_cipta, '%d-%m-%Y') AS tarikh_cipta
            FROM produk_kedai
            WHERE penjual_id = ?
            ORDER BY tarikh_cipta DESC
        `, [penjual.id]);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal menarik produk.' });
    }
};

// Penjual tambah produk baru (status terus SEMAK — tunggu admin luluskan)
export const tambahProdukPenjual = async (req, res) => {
    try {
        const [[penjual]] = await db.query('SELECT id FROM penjual_kedai WHERE no_kp = ? AND status = "AKTIF"', [req.user.no_kp]);
        if (!penjual) return res.status(403).json({ success: false, message: 'Akaun penjual tidak aktif.' });

        const { nama_produk, deskripsi, harga, stok_semasa, saiz_tersedia } = req.body;
        if (!nama_produk) return res.status(400).json({ success: false, message: 'Nama produk wajib diisi.' });
        if (!harga || parseFloat(harga) <= 0) return res.status(400).json({ success: false, message: 'Harga produk wajib diisi.' });

        let gambarUtama = null;
        if (req.files && req.files.length > 0) {
            gambarUtama = `/uploads/images/${req.files[0].filename}`;
        }

        await db.query(`
            INSERT INTO produk_kedai (nama_produk, deskripsi, harga, stok_semasa, gambar, saiz_tersedia, penjual_id, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'SEMAK')
        `, [nama_produk, deskripsi || null, parseFloat(harga), parseInt(stok_semasa) || 0, gambarUtama, saiz_tersedia || null, penjual.id]);

        return res.status(201).json({ success: true, message: 'Produk dihantar untuk semakan admin.' });
    } catch (err) {
        console.error('[PENJUAL] tambahProduk:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menambah produk.' });
    }
};

// Penjual kemaskini produk milik mereka (hanya SEMAK atau DITOLAK — boleh edit semula)
export const kemaskiniProdukPenjual = async (req, res) => {
    try {
        const [[penjual]] = await db.query('SELECT id FROM penjual_kedai WHERE no_kp = ? AND status = "AKTIF"', [req.user.no_kp]);
        if (!penjual) return res.status(403).json({ success: false, message: 'Akaun penjual tidak aktif.' });

        const { id } = req.params;
        const [[produk]] = await db.query('SELECT id, status FROM produk_kedai WHERE id = ? AND penjual_id = ?', [id, penjual.id]);
        if (!produk) return res.status(404).json({ success: false, message: 'Produk tidak dijumpai.' });

        const { nama_produk, deskripsi, harga, stok_semasa, saiz_tersedia } = req.body;
        const fields = [];
        const vals = [];

        if (nama_produk !== undefined) { fields.push('nama_produk = ?'); vals.push(nama_produk); }
        if (deskripsi !== undefined)   { fields.push('deskripsi = ?');   vals.push(deskripsi); }
        if (harga !== undefined)       { fields.push('harga = ?');       vals.push(parseFloat(harga)); }
        if (stok_semasa !== undefined) { fields.push('stok_semasa = ?'); vals.push(parseInt(stok_semasa)); }
        if (saiz_tersedia !== undefined){ fields.push('saiz_tersedia = ?'); vals.push(saiz_tersedia || null); }

        if (req.files && req.files.length > 0) {
            fields.push('gambar = ?');
            vals.push(`/uploads/images/${req.files[0].filename}`);
        }

        // Hantar semula untuk semakan jika sebelum ini AKTIF atau DITOLAK
        if (['AKTIF', 'DITOLAK'].includes(produk.status)) {
            fields.push('status = ?', 'nota_tolak = ?');
            vals.push('SEMAK', null);
        }

        if (fields.length === 0) return res.status(400).json({ success: false, message: 'Tiada data untuk dikemaskini.' });

        vals.push(id);
        await db.query(`UPDATE produk_kedai SET ${fields.join(', ')} WHERE id = ?`, vals);
        return res.status(200).json({ success: true, message: 'Produk dikemaskini dan dihantar semula untuk semakan.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal mengemaskini produk.' });
    }
};

// Penjual padam produk milik mereka
export const padamProdukPenjual = async (req, res) => {
    try {
        const [[penjual]] = await db.query('SELECT id FROM penjual_kedai WHERE no_kp = ? AND status = "AKTIF"', [req.user.no_kp]);
        if (!penjual) return res.status(403).json({ success: false, message: 'Akaun penjual tidak aktif.' });

        const [[produk]] = await db.query('SELECT id FROM produk_kedai WHERE id = ? AND penjual_id = ?', [req.params.id, penjual.id]);
        if (!produk) return res.status(404).json({ success: false, message: 'Produk tidak dijumpai.' });

        await db.query('DELETE FROM produk_kedai WHERE id = ?', [req.params.id]);
        return res.status(200).json({ success: true, message: 'Produk berjaya dipadam.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal memadam produk.' });
    }
};

// Penjual lihat jualan produk mereka + ringkasan pendapatan
export const jualanPenjual = async (req, res) => {
    try {
        const [[penjual]] = await db.query('SELECT id FROM penjual_kedai WHERE no_kp = ? AND status = "AKTIF"', [req.user.no_kp]);
        if (!penjual) return res.status(403).json({ success: false, message: 'Akaun penjual tidak aktif.' });

        // Cari semua pesanan yang ada item dari produk penjual ini
        const [pesanan] = await db.query(`
            SELECT DISTINCT
                p.id, p.status_pesanan, p.jumlah_keseluruhan, p.is_percuma,
                p.kaedah_penghantaran, p.kos_postage,
                DATE_FORMAT(p.tarikh_pesanan, '%d-%m-%Y %H:%i') AS tarikh_pesanan,
                u.nama_pegawai AS nama_pembeli
            FROM pesanan_kedai p
            JOIN item_pesanan i ON i.pesanan_id = p.id
            JOIN produk_kedai pr ON pr.id = i.produk_id
            JOIN users u ON u.no_kp = p.no_kp
            WHERE pr.penjual_id = ?
              AND p.status_pesanan IN ('DIBAYAR','DIPROSES','SELESAI')
            ORDER BY p.tarikh_pesanan DESC
        `, [penjual.id]);

        for (const p of pesanan) {
            const [items] = await db.query(`
                SELECT i.kuantiti, i.saiz, i.harga_seunit, pr.nama_produk
                FROM item_pesanan i
                JOIN produk_kedai pr ON pr.id = i.produk_id
                WHERE i.pesanan_id = ? AND pr.penjual_id = ?
            `, [p.id, penjual.id]);
            p.items = items;
            // Hasil untuk pesanan ini: jumlah (harga × kuantiti) - komisyen RM1/item - FPX RM1/pesanan
            const hasil = items.reduce((s, it) => s + (parseFloat(it.harga_seunit) * it.kuantiti), 0);
            const bilanganItem = items.reduce((s, it) => s + it.kuantiti, 0);
            p.hasil_kasar = hasil;
            p.komisyen_kelab = bilanganItem * 1; // RM1 per item
            p.caj_fpx = 1; // RM1 per transaksi
            p.anggaran_bersih = hasil - p.komisyen_kelab - p.caj_fpx;
        }

        // Ringkasan keseluruhan
        const hasil_kasar_total = pesanan.reduce((s, p) => s + p.hasil_kasar, 0);
        const komisyen_total = pesanan.reduce((s, p) => s + p.komisyen_kelab, 0);
        const fpx_total = pesanan.reduce((s, p) => s + p.caj_fpx, 0);
        const bersih_total = hasil_kasar_total - komisyen_total - fpx_total;

        return res.status(200).json({
            success: true,
            data: pesanan,
            ringkasan: { hasil_kasar: hasil_kasar_total, komisyen_kelab: komisyen_total, caj_fpx: fpx_total, bersih: bersih_total }
        });
    } catch (err) {
        console.error('[PENJUAL] jualanPenjual:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik data jualan.' });
    }
};

// ── ADMIN: Senarai produk penjual dalam semakan ──
export const senaraiProdukSemak = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT pk.id, pk.nama_produk, pk.deskripsi, pk.harga, pk.stok_semasa,
                   pk.gambar, pk.saiz_tersedia, pk.status, pk.nota_tolak,
                   pj.nama_perniagaan, pj.no_kp AS penjual_no_kp,
                   u.nama_pegawai AS nama_penjual, u.emel,
                   DATE_FORMAT(pk.tarikh_cipta, '%d-%m-%Y %H:%i') AS tarikh_hantar
            FROM produk_kedai pk
            JOIN penjual_kedai pj ON pj.id = pk.penjual_id
            JOIN users u ON u.no_kp = pj.no_kp
            WHERE pk.status IN ('SEMAK','DITOLAK')
            ORDER BY FIELD(pk.status,'SEMAK','DITOLAK'), pk.tarikh_cipta ASC
        `);
        return res.status(200).json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal menarik senarai semakan produk.' });
    }
};

// ── ADMIN: Luluskan atau tolak produk penjual ──
export const semakProdukPenjual = async (req, res) => {
    const { id } = req.params;
    const { status, nota_tolak } = req.body;
    if (!['AKTIF', 'DITOLAK'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status mesti AKTIF atau DITOLAK.' });
    }
    try {
        await db.query('UPDATE produk_kedai SET status = ?, nota_tolak = ? WHERE id = ?',
            [status, nota_tolak || null, id]);
        return res.status(200).json({ success: true, message: `Produk ${status === 'AKTIF' ? 'diluluskan' : 'ditolak'}.` });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gagal mengemaskini status produk.' });
    }
};

// ============================================================
// ── AHLI: LIHAT SEJARAH PESANAN (PESANAN SAYA)
// ============================================================
export const senaraiPesananAhli = async (req, res) => {
    try {
        const no_kp = req.user.no_kp;
        const [pesanan] = await db.query(`
            SELECT p.id, p.billCode, p.jumlah_keseluruhan, p.is_percuma, p.status_pesanan, p.nota_admin,
                   p.kaedah_penghantaran, p.alamat_penghantaran, p.kos_postage,
                   DATE_FORMAT(p.tarikh_pesanan, '%d-%m-%Y %H:%i') AS tarikh_pesanan
            FROM pesanan_kedai p
            WHERE p.no_kp = ?
            ORDER BY p.tarikh_pesanan DESC
        `, [no_kp]);

        for (const p of pesanan) {
            const [items] = await db.query(`
                SELECT i.kuantiti, i.saiz, i.harga_seunit, pr.nama_produk, pr.gambar, pr.gambar_galeri
                FROM item_pesanan i
                JOIN produk_kedai pr ON i.produk_id = pr.id
                WHERE i.pesanan_id = ?
            `, [p.id]);
            p.items = items;
        }
        return res.status(200).json({ success: true, data: pesanan });
    } catch (err) {
        console.error('[KEDAI] senaraiPesananAhli:', err.message);
        return res.status(500).json({ success: false, message: 'Gagal menarik senarai pesanan anda.' });
    }
};