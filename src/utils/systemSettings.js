import db from '../config/db.js';

/**
 * Baca tetapan boolean sistem terus dari pangkalan data.
 * Tetapan yang belum wujud menggunakan nilai lalai supaya migrasi lama kekal serasi.
 */
export const tetapanSistemAktif = async (kunci, nilaiLalai = true) => {
    const [[tetapan]] = await db.query(
        'SELECT nilai FROM tetapan_sistem WHERE kunci = ? LIMIT 1',
        [kunci]
    );

    if (!tetapan) return nilaiLalai;
    return Number(tetapan.nilai) === 1;
};

export const toyyibPayAktif = () => tetapanSistemAktif('toyyibpay_enabled', true);

export const responsToyyibPayDitutup = (res) => res.status(503).json({
    success: false,
    code: 'TOYYIBPAY_DISABLED',
    message: 'ToyyibPay ditutup sementara. Sila cuba semula kemudian atau gunakan kaedah bayaran lain.',
});
