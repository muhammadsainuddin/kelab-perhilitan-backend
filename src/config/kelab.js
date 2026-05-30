// ============================================================
// Maklumat Rasmi Pertubuhan — Kelab PERHILITAN
// Satu sumber kebenaran untuk emel, resit FPX & dokumen rasmi.
// Kemas kini di sini sahaja jika butiran berubah.
// ============================================================

export const KELAB = {
  nama: 'Kelab Sukan dan Kebajikan Jabatan Perlindungan Hidupan Liar dan Taman Negara (Kelab PERHILITAN)',
  namaPendek: 'Kelab PERHILITAN',
  noPertubuhan: 'PPM-006-14-27071985',
  alamat: 'Ibu Pejabat Jabatan Perlindungan Hidupan Liar dan Taman Negara (PERHILITAN), KM.10 Jalan Cheras, 56100 Cheras Kuala Lumpur.',
  emel: 'kelabperhilitan@gmail.com',
};

// Blok footer HTML untuk semua emel rasmi (resit, notifikasi, dsb.)
export const footerEmelHTML = () => `
  <div style="background-color:#f8f9fa;border-top:1px solid #eaeded;padding:18px 24px;text-align:center;font-family:Arial,sans-serif;color:#7f8c8d;font-size:11px;line-height:1.6;">
    <p style="margin:0;font-weight:bold;color:#08151D;">${KELAB.nama}</p>
    <p style="margin:4px 0 0;">No. Pendaftaran: ${KELAB.noPertubuhan}</p>
    <p style="margin:2px 0 0;">${KELAB.alamat}</p>
    <p style="margin:2px 0 0;">E-mel: ${KELAB.emel}</p>
  </div>
`;
