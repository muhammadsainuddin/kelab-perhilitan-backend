import db from '../config/db.js';
import { janaNoAhliBaru } from './keahlianHelper.js';
import { semakTransaksiBil } from './toyyibpay.js';
import { janaNoResitManual } from '../controllers/resitController.js';

// ============================================================
// Modul pusat pemprosesan bayaran ToyyibPay.
// Semua tempat (webhook, semakan manual, sync berkala) guna fungsi
// yang sama di sini supaya logik tidak berulang & konsisten.
// ============================================================

// ── Proses YURAN berjaya: beri no ahli (jika perlu), kemaskini status, rekod buku tunai ──
export const prosesYuranBerjaya = async (billcode) => {
    const [bayaran] = await db.query('SELECT no_kp, status, amaun, keterangan FROM sejarah_bayaran WHERE billCode = ?', [billcode]);
    if (bayaran.length === 0 || bayaran[0].status !== 'PENDING') return; // hanya proses bil PENDING — elak proses berganda

    const { no_kp, amaun, keterangan } = bayaran[0];
    const [ahli] = await db.query('SELECT no_ahli FROM users WHERE no_kp = ?', [no_kp]);

    // Beri nombor ahli secara automatik untuk ahli manual yang berjaya bayar
    if (ahli.length > 0) {
        const noAhliSedia = ahli[0].no_ahli;
        if (!noAhliSedia || String(noAhliSedia).trim() === '') {
            const noAhliBaru = await janaNoAhliBaru();
            await db.query('UPDATE users SET no_ahli = ? WHERE no_kp = ?', [noAhliBaru, no_kp]);
        }
    }

    await db.query('UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', [billcode]);

    try { await janaNoResitManual(billcode); } catch (e) {
        console.error('[RESIT] Gagal jana no_resit manual:', e.message);
    }

    try {
        await db.query(`
            INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota, no_kp_pihak)
            VALUES ('MASUK', 'YURAN', ?, ?, ?, ?)
        `, [amaun, billcode, keterangan || 'Bayaran Yuran Kelab Tahunan', no_kp]);
    } catch (e) {
        console.error('[YURAN] Gagal rekod transaksi kewangan:', e.message);
    }

    // Rekod caj ToyyibPay RM1.00 secara automatik sebagai perbelanjaan operasi FPX
    try {
        await db.query(`
            INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota)
            VALUES ('KELUAR', 'OPERASI', 1.00, ?, ?)
        `, [billcode, `Caj ToyyibPay FPX — Yuran ${no_kp}`]);
    } catch (e) {
        console.error('[YURAN] Gagal rekod caj ToyyibPay:', e.message);
    }
};

// ── Proses PESANAN KEDAI berjaya: tolak stok + rekod buku tunai (transaksi atomik) ──
export const prosesKedaiBerjaya = async (pesananId) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[pesanan]] = await conn.query('SELECT * FROM pesanan_kedai WHERE id = ? FOR UPDATE', [pesananId]);
        // Elak proses dua kali (idempotent)
        if (!pesanan || ['DIBAYAR', 'DIPROSES', 'SELESAI'].includes(pesanan.status_pesanan)) {
            await conn.rollback();
            return;
        }

        await conn.query('UPDATE pesanan_kedai SET status_pesanan = "DIBAYAR" WHERE id = ?', [pesananId]);
        const [items] = await conn.query('SELECT produk_id, kuantiti, saiz FROM item_pesanan WHERE pesanan_id = ?', [pesananId]);

        for (const it of items) {
            const [[prod]] = await conn.query('SELECT id, is_variasi, variasi_data, stok_semasa FROM produk_kedai WHERE id = ? FOR UPDATE', [it.produk_id]);
            if (!prod) continue;

            if (prod.is_variasi) {
                let vData = [];
                try { vData = JSON.parse(prod.variasi_data || '[]'); } catch (e) {}
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
            `, [pesanan.jumlah_keseluruhan, pesanan.billCode, `Jualan Kedai — Pesanan #${pesananId}`, pesanan.no_kp]);
        } catch (e) {}

        // Rekod caj ToyyibPay RM1.00 secara automatik sebagai perbelanjaan operasi FPX
        try {
            await conn.query(`
                INSERT INTO transaksi_kewangan (jenis_aliran, kategori, amaun, rujukan, nota)
                VALUES ('KELUAR', 'OPERASI', 1.00, ?, ?)
            `, [pesanan.billCode || `KEDAI-${pesananId}`, `Caj ToyyibPay FPX — Pesanan Kedai #${pesananId}`]);
        } catch (e) {
            console.error('[KEDAI] Gagal rekod caj ToyyibPay:', e.message);
        }

        await conn.commit();
    } catch (e) {
        await conn.rollback();
        console.error('[KEDAI] Gagal proses pesanan berjaya:', e.message);
    } finally {
        conn.release();
    }
};

// ── Segerakkan SEMUA bil PENDING (yuran + kedai) dengan ToyyibPay. ──
//    Dipanggil secara berkala (interval) sebagai jaring keselamatan jika webhook gagal sampai.
export const segerakSemuaPending = async () => {
    // Yuran
    try {
        const [pendingYuran] = await db.query(`SELECT billCode FROM sejarah_bayaran WHERE status = 'PENDING'`);
        for (const item of pendingYuran) {
            try {
                const status = await semakTransaksiBil(item.billCode);
                if (status === 'BERJAYA') await prosesYuranBerjaya(item.billCode);
                else if (status === 'GAGAL') await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [item.billCode]);
            } catch (e) {}
        }
    } catch (e) { console.error('[SYNC] Ralat segerak yuran:', e.message); }

    // Kedai
    try {
        const [pendingKedai] = await db.query(`SELECT id, billCode FROM pesanan_kedai WHERE status_pesanan = 'PENDING' AND billCode IS NOT NULL`);
        for (const item of pendingKedai) {
            try {
                const status = await semakTransaksiBil(item.billCode);
                if (status === 'BERJAYA') await prosesKedaiBerjaya(item.id);
                else if (status === 'GAGAL') await db.query('UPDATE pesanan_kedai SET status_pesanan = "DIBATALKAN" WHERE id = ?', [item.id]);
            } catch (e) {}
        }
    } catch (e) { console.error('[SYNC] Ralat segerak kedai:', e.message); }
};
