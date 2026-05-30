// src/utils/toyyibpay.js
import axios from 'axios';
import dotenv from 'dotenv';
import { KELAB, footerEmelHTML } from '../config/kelab.js';

dotenv.config();

const TOYYIBPAY_URL = process.env.TOYYIBPAY_URL || 'https://dev.toyyibpay.com/index.php/api/createBill';
const SECRET_KEY    = process.env.SECRET_KEY    || 'g0jw4dtf-1mgf-l4au-les2-se8kpdg9beoe';
const CATEGORY_CODE = process.env.CATEGORY_CODE || 'v4vftvzw';

/**
 * Fungsi Modular untuk Menjana Bil FPX ToyyibPay
 */
export const janaBilFPX = async ({
    keterangan,
    amaun,
    returnUrl,
    callbackUrl,
    referenceNo,
    user,
    jenis = 'YURAN' // 'YURAN' atau 'KEDAI'
}) => {
    const amountInCents = Math.round(parseFloat(amaun) * 100);
    const billName = jenis === 'YURAN' ? 'Yuran Kelab PERHILITAN' : 'Kedai Kelab PERHILITAN';

    // ── Resit E-mel Tersuai (Hanya untuk Yuran) ──
    let contentEmail = "";
    if (jenis === 'YURAN') {
        contentEmail = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #08151D; color: #87BCB5; padding: 24px; text-align: center;">
                    <h2 style="margin: 0; font-size: 18px; text-transform: uppercase;">Resit Rasmi Pembayaran</h2>
                    <p style="margin: 6px 0 0; font-size: 11px; color: #D0D7D7; line-height: 1.4;">${KELAB.nama}</p>
                    <p style="margin: 3px 0 0; font-size: 10px; color: #9fb3b3;">No. Pendaftaran: ${KELAB.noPertubuhan}</p>
                </div>
                <div style="padding: 24px; color: #333333; line-height: 1.5; font-size: 13px;">
                    <p>Salam Sejahtera <b>${user.nama_pegawai}</b>,</p>
                    <p>Transaksi anda telah berjaya diproses secara selamat menerusi gerbang FPX ToyyibPay.</p>
                    <div style="background-color: #f8f9fa; border: 1px solid #eaeded; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">BUTIRAN BIL:</td><td style="padding: 4px 0; font-weight: bold; text-align: right;">${keterangan}</td></tr>
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">JUMLAH:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #08151D; font-size: 14px;">RM ${parseFloat(amaun).toFixed(2)}</td></tr>
                        </table>
                    </div>
                </div>
                ${footerEmelHTML()}
            </div>
        `;
    }

    // ── Sediakan Data ToyyibPay ──
    const formData = new URLSearchParams({
        userSecretKey: SECRET_KEY,
        categoryCode:  CATEGORY_CODE,
        billName:      billName,
        billDescription: keterangan,
        billPriceSetting: 1,
        billPayorInfo:    1,
        billAmount:       amountInCents.toString(),
        billReturnUrl:    returnUrl,
        billCallbackUrl:  callbackUrl,
        billExternalReferenceNo: referenceNo,
        billTo:    user.nama_pegawai || 'Ahli Kelab',
        billEmail: user.emel || 'kelabperhilitan@gmail.com',
        billPhone: user.phone || '0123456789',
        billSplitPayment: 0,
        billPaymentChannel: 0,
        billChargeToCustomer: 1
    });

    if (contentEmail) {
        formData.append('billContentEmail', contentEmail);
    }

    // ── Hantar ke API ToyyibPay ──
    const response = await axios.post(TOYYIBPAY_URL, formData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const billCode = response.data[0]?.BillCode;
    if (!billCode) throw new Error("Gagal mendapatkan BillCode dari ToyyibPay");

    // Jika guna akaun production, buang perkataan 'dev.'
    const isDev = TOYYIBPAY_URL.includes('dev.toyyibpay');
    const billUrl = isDev ? `https://dev.toyyibpay.com/${billCode}` : `https://toyyibpay.com/${billCode}`;

    return { billCode, billUrl };
};

/**
 * Sahkan status sebenar sesuatu bil terus dengan pelayan ToyyibPay.
 * JANGAN percaya status yang dihantar dalam body callback — sentiasa sahkan di sini.
 * @returns {Promise<'BERJAYA'|'GAGAL'|'PENDING'>}
 */
export const semakTransaksiBil = async (billCode) => {
    const checkUrl = TOYYIBPAY_URL.replace('createBill', 'getBillTransactions');
    const formData = new URLSearchParams({ billCode });

    const res = await axios.post(checkUrl, formData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!res.data || res.data.length === 0) return 'PENDING';
    if (res.data.find(tx => tx.billpaymentStatus == '1')) return 'BERJAYA';
    if (res.data.find(tx => tx.billpaymentStatus == '3')) return 'GAGAL';
    return 'PENDING';
};