/**
 * Seed skrip: Rekod sumbangan syarikat/agensi luar — SAKOM 2026
 * Jalankan sekali: node seed-sumbangan-sakom2026.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

// Data dari: 2352026 SENARAI SUMBANGAN.csv
// Format: [PTJ, PIC, NamaSyarikat, Pakej, Nilai, Catatan, Transaksi]
const data = [
    // HQ
    ['HQ', 'Nurain Arshad', 'KOP LOGISTIC & DISTRIBUTION SDN. BHD.', 'PERAK', 5000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Nurain Arshad', 'VERTEX ENERGY RESOURCES', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Nurain Arshad', 'GLOBAL ERA REVOLUTIONS SDN BHD', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Fitri Lestary', 'ALL TERRAIN ENTERPRISE', 'PERAK', 5000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Fitri Lestary', 'NILAM PRESTASI ENTERPRISE', 'GANGSA', 2000, 'TIADA BORANG JAWAPAN', 'ONLINE TRANSFER'],
    ['HQ', 'Aini Hayati', 'PRISMA KHAS SDN. BHD.', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Khatilah', 'DIZA MAJU SERVICE', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['HQ', 'Khatilah', 'ONE LAZULI SDN BHD', 'PERAK', 8000, 'LENGKAP', 'ONLINE TRANSFER'],
    // WP
    ['WP', 'Abdul Rahman Mustapa', 'DSV LOGISTICS SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['WP', 'Abdul Rahman Mustapa', 'AIRLIFT ASSOCIATES SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // Selangor
    ['Selangor', 'Mohd Amir Abu Bakar', 'DATUK ANUAR BIN ABU HASSAN', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Selangor', 'Mohd Amir Abu Bakar', 'AWANG GEMILANG SAWIT TRADING', 'GANGSA', 3000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Selangor', 'Mohd Amir Abu Bakar', 'ASITRIAL LOGISTIC SDN BHD', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Selangor', 'Mohd Amir Abu Bakar', 'FAZZ FOCUS ENTERPRISE', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Selangor', 'Mohd Amir Abu Bakar', 'MESRA EKUITI SDN BHD', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Selangor', 'Mohd Amir Abu Bakar', 'PERNIAGAAN AH LEK', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    // MTCC
    ['MTCC', 'Idham', 'DYNAMIC WANS ENTERPRISE', 'UTAMA', 15000, 'LENGKAP', 'CHEQUE DISERAHKAN 11/5/2026'],
    // Pahang
    ['Pahang', 'Abdullah Zawawi Yazid', 'MF FLEXIS SDN BHD', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Pahang', 'Abdullah Zawawi Yazid', 'ZHAFIR MAKMUR', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // Terengganu
    ['Terengganu', 'Mohd Zaki Mohd Rahim', 'BEST TRADE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // Kelantan
    ['Kelantan', 'Aniza Binti Ibrahim', 'YEE COPIER SALES & SERVICE', 'ASAS', 300, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'RIFFIN TRADING', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'DATIN HJH NIK AIDIL MARINA', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'NMR GLOBAL LEGACY', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'PRESTASI SETIA UNGGUL SDN. BHD.', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'MF FLEXIS SDN. BHD.', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kelantan', 'Aniza Binti Ibrahim', 'SYARIKAT PERNIAGAAN HAFIZ', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    // Kedah
    ['Kedah', 'Nor Hani Abdul Samat', 'AZ EASY TRAVEL', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kedah', 'Nor Hani Abdul Samat', 'TAT GUAN WORKSHOP', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kedah', 'Nor Hani Abdul Samat', 'RIMBA NURI FARM', 'ASAS', 600, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kedah', 'Nor Hani Abdul Samat', 'TAMAN BUAYA LANGKAWI', 'PERAK', 5000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kedah', 'Nor Hani Abdul Samat', 'ZHAFIR MAKMUR', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Kedah', 'Nor Hani Abdul Samat', 'ADY MALAU ENTERPRISE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // Perak
    ['Perak', 'Fariz Rizal Azmi', 'NATURES ART ENTERPRISE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Perak', 'Fariz Rizal Azmi', 'SUNNY INTERNATIONAL LEATHER SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Perak', 'Fariz Rizal Azmi', 'SOON HENG REPTILE SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // P. Pinang
    ['P. Pinang', 'Syukri Bakar', 'ABV GLOBAL HOLDINGS SDN BHD', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['P. Pinang', 'Syukri Bakar', 'VANDA DYNAMIC ENTERPRISE', 'ASAS', 200, 'LENGKAP', 'ONLINE TRANSFER'],
    // TN P. Pinang
    ['TN P. Pinang', 'Muhammad B. Sainuddin', 'PINTASAN SINAR SDN. BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['TN P. Pinang', 'Muhammad B. Sainuddin', 'NFS MAJU EMPIRE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['TN P. Pinang', 'Muhammad B. Sainuddin', 'KMK PRINTING & GRAPHIC SDN. BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // PKGK
    ['PKGK', 'Ku Mohd Hafizi Ku Abdul Rahman', 'MEDALLION CREATIVE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['PKGK', 'Ku Mohd Hafizi Ku Abdul Rahman', 'GOLDEN HORN CREATIVE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['PKGK', 'Ku Mohd Hafizi Ku Abdul Rahman', 'TERATAK AEDEN (JK) DEVELOPMENT SDN BHD', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['PKGK', 'Ku Mohd Hafizi Ku Abdul Rahman', 'SEBERANG MUTIARA CONSTRUCTION', 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    // RHLTH
    ['RHLTH', 'Juliawani Johari', 'AZ EASY TRAVEL', 'ASAS', 500, 'TIADA BORANG JAWAPAN', 'ONLINE TRANSFER'],
    ['RHLTH', 'Juliawani Johari', 'ALAM PADU ENTERPRISE', 'ASAS', 500, 'TIADA BORANG JAWAPAN', 'ONLINE TRANSFER'],
    ['RHLTH', 'Juliawani Johari', 'MEDAL LIONS CREATIVE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['RHLTH', 'Juliawani Johari', 'GOLDEN HORN CREATIVE SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['RHLTH', 'Juliawani Johari', 'XTREME TECHNO SIGN ENTERPRISE', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['RHLTH', 'Juliawani Johari', 'MONA FAIRUZ BT RAMLI', 'ASAS', 500, 'TIADA BORANG JAWAPAN', 'BELUM DITERIMA'],
    ['RHLTH', 'Juliawani Johari', 'GAMUDA LAND', 'UTAMA', 15000, 'TIADA BORANG JAWAPAN', 'CHEQUE DISERAHKAN PADA MAJLIS'],
    ['RHLTH', 'Juliawani Johari', 'ZHAFIR MAKMUR', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // NWRC
    ['NWRC', 'Usama Alifa', 'ROSENOR ENTERPRISE', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['NWRC', 'Usama Alifa', 'IZ VENTURE ENTERPRISE', 'ASAS', 1500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['NWRC', 'Usama Alifa', 'MF LEGACY AGROFARM', 'PERAK', 5000, 'LENGKAP', 'ONLINE TRANSFER'],
    // Tmn Neg Pahang
    ['Tmn Neg Pahang', 'Muhammad Affika', 'MUTIARA TAMAN NEGARA', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Tmn Neg Pahang', 'Muhammad Affika', 'NKS HOTEL & TRAVEL SDN BHD', 'ASAS', 200, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Tmn Neg Pahang', 'Muhammad Affika', 'JO GLOBAL SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    // Melaka
    ['Melaka', 'Alfiesyahril Anewar Ahmad', 'ZOO MELAKA SDN BHD', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Melaka', 'Alfiesyahril Anewar Ahmad', 'TAMAN RAMA-RAMA DAN REPTILIA MELAKA', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['Melaka', 'Alfiesyahril Anewar Ahmad', "A'FAMOSA SAFARI WONDERLAND", 'GANGSA', 2000, 'LENGKAP', 'ONLINE TRANSFER'],
    // N. Sembilan
    ['N. Sembilan', 'Zulkefli Husin', 'KAWALAN KESELAMATAN BG SDN BHD', 'ASAS', 1000, 'LENGKAP', 'ONLINE TRANSFER'],
    ['N. Sembilan', 'Zulkefli Husin', 'MITRA BAYU RESOURCES', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['N. Sembilan', 'Zulkefli Husin', 'NILAI ARMS & AMMUNITION SDN BHD', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
    ['N. Sembilan', 'Zulkefli Husin', 'MECACOM TECHNOLOGIES SDN BHD', 'ASAS', 200, 'LENGKAP', 'ONLINE TRANSFER'],
    // PIW
    ['PIW', 'Nicholas Sandar', 'EZUMI SALES & SERVICES', 'ASAS', 500, 'LENGKAP', 'ONLINE TRANSFER'],
];

let berjaya = 0;
let jumlahRM = 0;

for (const [ptj, pic, nama, pakej, nilai, catatan, transaksi] of data) {
    const rujukan = `SAKOM 2026 — Pakej ${pakej}`;
    const nota    = `PTJ: ${ptj} | PIC: ${pic} | ${catatan} | ${transaksi}`;

    await db.execute(
        `INSERT INTO transaksi_kewangan
            (jenis_aliran, kategori, amaun, rujukan, nota, penerima_bayaran)
         VALUES ('MASUK', 'SUMBANGAN', ?, ?, ?, ?)`,
        [nilai, rujukan, nota, nama]
    );

    berjaya++;
    jumlahRM += nilai;
    console.log(`✓ [${ptj}] ${nama} — RM${nilai.toLocaleString()}`);
}

const jumlah = data.length;
console.log(`\n✅ ${berjaya}/${jumlah} rekod berjaya dimasukkan.`);
console.log(`💰 Jumlah keseluruhan: RM${jumlahRM.toLocaleString()}`);

await db.end();
