/**
 * migrate_sakom.js
 * Gantikan semua rekod kutipan_sumbangan_luar SAKOM dengan data CSV terbaru.
 * Jalankan sekali: node src/migrate_sakom.js
 */
import db from './config/db.js';

const TARIKH_DEFAULT = '2026-07-11';

// Data dari SENARAISUMBANGAN.csv: [cawangan, pic, syarikat, pakej, amaun]
const DATA = [
  // HQ
  ['HQ', 'NURAIN BINTI ARSHAD', 'KOP LOGISTIC & DISTRIBUTION SDN. BHD.', 'PERAK', 5000],
  ['HQ', 'NURAIN BINTI ARSHAD', 'VERTEX ENERGY RESOURCES', 'ASAS', 1000],
  ['HQ', 'NURAIN BINTI ARSHAD', 'GLOBAL ERA REVOLUTIONS SDN BHD', 'GANGSA', 2000],
  ['HQ', 'Fitri Lestary', 'ALL TERRAIN ENTERPRISE', 'PERAK', 5000],
  ['HQ', 'Fitri Lestary', 'NILAM PRESTASI ENTERPRISE', 'PERAK', 5000],
  ['HQ', 'Aini Hayati', 'PRISMA KHAS SDN. BHD.', 'ASAS', 500],
  ['HQ', 'Khatilah', 'DIZA MAJU SERVICE', 'GANGSA', 2000],
  ['HQ', 'Khatilah', 'ONE LAZULI SDN BHD', 'PERAK', 8000],
  ['HQ', 'Adha', 'MEWAH KELANA ENTERPRISE', 'ASAS', 500],
  ['HQ', 'Adha', 'UPM CONSULTANCY & SERVICES SDN. BHD.', 'EMAS', 10000],
  ['HQ', 'Adha', 'SEPANG GOLDCOAST SDN. BHD', 'GANGSA', 2000],
  ['HQ', 'Adha', 'EXPORT-IMPORT BANK OF MALAYSIA BERHAD', 'PERAK', 5000],
  ['HQ', 'Fitri Lestary', 'TI PROPERTIES SDN. BHD', 'GANGSA', 2000],
  // WP
  ['WP', 'ABDUL RAHMAN BIN MUSTAPA', 'DSV LOGISTICS SDN BHD', 'ASAS', 500],
  ['WP', 'ABDUL RAHMAN BIN MUSTAPA', 'AIRLIFT ASSOCIATES SDN BHD', 'ASAS', 500],
  // Selangor
  ['Selangor', 'Mohd Amir Abu Bakar', 'DATUK ANUAR BIN ABU HASSAN', 'GANGSA', 2000],
  ['Selangor', 'Mohd Amir Abu Bakar', 'AWANG GEMILANG SAWIT TRADING', 'GANGSA', 3000],
  ['Selangor', 'Mohd Amir Abu Bakar', 'ASITRIAL LOGISTIC SDN BHD', 'GANGSA', 2000],
  ['Selangor', 'Mohd Amir Abu Bakar', 'FAZZ FOCUS ENTERPRISE', 'GANGSA', 2000],
  ['Selangor', 'Mohd Amir Abu Bakar', 'MESRA EKUITI SDN BHD', 'GANGSA', 2000],
  ['Selangor', 'Mohd Amir Abu Bakar', 'PERNIAGAAN AH LEK', 'GANGSA', 2000],
  // MTCC
  ['MTCC', 'IDHAM', 'DYNAMIC WANS ENTERPRISE', 'UTAMA', 15000],
  // Pahang
  ['Pahang', 'ABDULLAH ZAWAWI BIN YAZID', 'MF FLEXIS SDN BHD', 'ASAS', 1000],
  ['Pahang', 'ABDULLAH ZAWAWI BIN YAZID', 'ZHAFIR MAKMUR', 'ASAS', 500],
  ['Pahang', 'ABDULLAH ZAWAWI BIN YAZID', 'SYARIKAT MYTACES ENTERPRISE', 'ASAS', 500],
  ['Pahang', 'ABDULLAH ZAWAWI BIN YAZID', 'KOPERASI JABATAN PERHILITAN NEGERI PAHANG BERHAD', 'ASAS', 500],
  // Terengganu
  ['Terengganu', 'MOHD ZAKI BIN MOHD RAHIM', 'BEST TRADE', 'ASAS', 500],
  // Kelantan
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'YEE COPIER SALES & SERVICE', 'ASAS', 300],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'RIFFIN TRADING', 'ASAS', 500],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'DATIN HJH NIK AIDIL MARINA', 'GANGSA', 2000],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'NMR GLOBAL LEGACY', 'ASAS', 500],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'PRESTASI SETIA UNGGUL SDN. BHD.', 'ASAS', 1000],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'MF FLEXIS SDN. BHD.', 'ASAS', 500],
  ['Kelantan', 'ANIZA BINTI IBRAHIM', 'SYARIKAT PERNIAGAAN HAFIZ', 'ASAS', 1000],
  // Kedah
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'AZ EASY TRAVEL', 'ASAS', 500],
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'TAT GUAN WORKSHOP', 'ASAS', 500],
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'RIMBA NURI FARM', 'ASAS', 600],
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'TAMAN BUAYA LANGKAWI', 'PERAK', 5000],
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'ZHAFIR MAKMUR', 'ASAS', 500],
  ['Kedah', 'NOR HANI BINTI ABDUL SAMAT', 'ADY MALAU ENTERPRISE', 'ASAS', 500],
  // Perak
  ['Perak', 'FARIZ RIZAL BIN AZMI', 'NATURES ART ENTERPRISE', 'ASAS', 500],
  ['Perak', 'FARIZ RIZAL BIN AZMI', 'SUNNY INTERNATIONAL LEATHER SDN BHD', 'ASAS', 500],
  ['Perak', 'FARIZ RIZAL BIN AZMI', 'SOON HENG REPTILE SDN BHD', 'ASAS', 500],
  // P. Pinang
  ['P. Pinang', 'MUHD SYUKRI BIN BAKAR', 'ABV GLOBAL HOLDINGS SDN BHD', 'ASAS', 1000],
  ['P. Pinang', 'MUHD SYUKRI BIN BAKAR', 'VANDA DYNAMIC ENTERPRISE', 'ASAS', 200],
  // TN P. Pinang
  ['TN P. Pinang', 'MUHAMMAD BIN SAINUDDIN', 'PINTASAN SINAR SDN. BHD', 'ASAS', 500],
  ['TN P. Pinang', 'MUHAMMAD BIN SAINUDDIN', 'NFS MAJU EMPIRE', 'ASAS', 500],
  ['TN P. Pinang', 'MUHAMMAD BIN SAINUDDIN', 'KMK PRINTING & GRAPHIC SDN. BHD', 'ASAS', 500],
  // PKGK
  ['PKGK', 'KU MOHD HAFIZI BIN KU ABDUL RAHMAN', 'MEDALLION CREATIVE', 'ASAS', 500],
  ['PKGK', 'KU MOHD HAFIZI BIN KU ABDUL RAHMAN', 'GOLDEN HORN CREATIVE', 'ASAS', 500],
  ['PKGK', 'KU MOHD HAFIZI BIN KU ABDUL RAHMAN', 'TERATAK AEDEN (JK) DEVELOPMENT SDN BHD', 'ASAS', 1000],
  ['PKGK', 'KU MOHD HAFIZI BIN KU ABDUL RAHMAN', 'SEBERANG MUTIARA CONSTRUCTION', 'GANGSA', 2000],
  // RHLTH
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'AZ EASY TRAVEL', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'ALAM PADU ENTERPRISE', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'MEDAL LIONS CREATIVE', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'GOLDEN HORN CREATIVE SDN BHD', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'XTREME TECHNO SIGN ENTERPRISE', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'MONA FAIRUZ BT RAMLI', 'ASAS', 500],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'GAMUDA LAND', 'UTAMA', 15000],
  ['RHLTH', 'JULIAWANI BINTI JOHARI', 'ZHAFIR MAKMUR', 'ASAS', 500],
  // NWRC
  ['NWRC', 'USAMA BIN MOHD ALIFA', 'ROSENOR ENTERPRISE', 'ASAS', 1000],
  ['NWRC', 'USAMA BIN MOHD ALIFA', 'IZ VENTURE ENTERPRISE', 'ASAS', 1500],
  ['NWRC', 'USAMA BIN MOHD ALIFA', 'MF LEGACY AGROFARM', 'PERAK', 5000],
  // Tmn Neg Pahang
  ['Tmn Neg Pahang', 'MUHAMMAD AFFIKA BIN JULRAIN', 'MUTIARA TAMAN NEGARA', 'ASAS', 500],
  ['Tmn Neg Pahang', 'MUHAMMAD AFFIKA BIN JULRAIN', 'NKS HOTEL & TRAVEL SDN BHD', 'ASAS', 200],
  ['Tmn Neg Pahang', 'MUHAMMAD AFFIKA BIN JULRAIN', 'JO GLOBAL SDN BHD', 'ASAS', 500],
  // Melaka
  ['Melaka', 'ALFIESYAHRIL ANEWAR BIN AHMAD', 'ZOO MELAKA SDN BHD', 'ASAS', 1000],
  ['Melaka', 'ALFIESYAHRIL ANEWAR BIN AHMAD', 'TAMAN RAMA-RAMA DAN REPTILIA MELAKA', 'ASAS', 1000],
  ['Melaka', 'ALFIESYAHRIL ANEWAR BIN AHMAD', "A'FAMOSA SAFARI WONDERLAND", 'GANGSA', 2000],
  // N. Sembilan
  ['N. Sembilan', 'ZULKEFLI BIN HUSIN', 'KAWALAN KESELAMATAN BG SDN BHD', 'ASAS', 1000],
  ['N. Sembilan', 'ZULKEFLI BIN HUSIN', 'MITRA BAYU RESOURCES', 'ASAS', 500],
  ['N. Sembilan', 'ZULKEFLI BIN HUSIN', 'NILAI ARMS & AMMUNITION SDN BHD', 'ASAS', 500],
  ['N. Sembilan', 'ZULKEFLI BIN HUSIN', 'MECACOM TECHNOLOGIES SDN BHD', 'ASAS', 200],
  // PIW
  ['PIW', 'NICHOLAS SANDAR', 'EZUMI SALES & SERVICES', 'ASAS', 500],
  // IBD
  ['IBD', 'MOHD NAZRI BIN AHLIP', 'HAFIZ NN ENTERPRISE', 'ASAS', 500],
  ['IBD', 'MOHD NAZRI BIN AHLIP', 'KEDAI EMAS SRI SEMANTAN', 'ASAS', 1000],
];

(async () => {
  try {
    // 1. Dapatkan acara SAKOM (id=1)
    const [[acara]] = await db.query(`SELECT id, nama FROM acara_khas WHERE id = 1`);
    if (!acara) throw new Error('Acara SAKOM (id=1) tidak dijumpai dalam database.');
    console.log(`✓ Acara: ${acara.nama} (id=${acara.id})`);

    // 2. Dapatkan semua pakej untuk acara ini
    const [pakejList] = await db.query(
      `SELECT id, nama FROM pakej_sumbangan WHERE acara_khas_id = ?`, [acara.id]
    );
    const pakejMap = {};
    for (const p of pakejList) {
      pakejMap[p.nama.trim().toUpperCase()] = p.id;
    }
    console.log(`✓ Pakej ditemui: ${Object.keys(pakejMap).join(', ')}`);

    // 3. Dapatkan semua pengguna untuk padanan PIC
    const [users] = await db.query(
      `SELECT no_kp, nama_pegawai FROM users WHERE status_ahli = 'aktif' ORDER BY nama_pegawai`
    );

    const cariPIC = (namaCari) => {
      if (!namaCari?.trim()) return null;
      const q = namaCari.toLowerCase().trim();
      // Cuba padanan penuh
      let u = users.find(x => x.nama_pegawai?.toLowerCase().trim() === q);
      if (u) return u.no_kp;
      // Cuba padanan sebahagian (nama pertama)
      const kata = q.split(/\s+/);
      u = users.find(x => kata.every(k => x.nama_pegawai?.toLowerCase().includes(k)));
      if (u) return u.no_kp;
      // Cuba nama pertama sahaja
      u = users.find(x => x.nama_pegawai?.toLowerCase().startsWith(kata[0]));
      return u?.no_kp || null;
    };

    // 4. Padam rekod lama untuk SAKOM
    const [del] = await db.query(
      `DELETE FROM kutipan_sumbangan_luar WHERE acara_khas_id = ?`, [acara.id]
    );
    console.log(`✓ Dipadam: ${del.affectedRows} rekod lama`);

    // 5. Masukkan rekod baru
    const tiadalink = [];
    let inserted = 0;

    for (const [cawangan, picNama, syarikat, pakejNama, amaun] of DATA) {
      const pakejId  = pakejMap[pakejNama.trim().toUpperCase()] || null;
      const picNoKp  = cariPIC(picNama);

      if (!pakejId)  console.warn(`  [!] Pakej tidak dijumpai: "${pakejNama}" (${syarikat})`);
      if (!picNoKp)  tiadalink.push(`${picNama} (${cawangan})`);

      await db.query(`
        INSERT INTO kutipan_sumbangan_luar
          (nama_acara, nama_syarikat, amaun, tarikh, nota, acara_khas_id, pakej_id, pic_no_kp, direkod_oleh)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `, [acara.nama, syarikat, amaun, TARIKH_DEFAULT, cawangan, acara.id, pakejId, picNoKp]);

      inserted++;
    }

    console.log(`\n✓ Berjaya dimasukkan: ${inserted} rekod`);

    if (tiadalink.length) {
      const unik = [...new Set(tiadalink)];
      console.log(`\n[!] PIC tidak dipadankan (rekod tetap disimpan tanpa PIC):`);
      unik.forEach(n => console.log(`    - ${n}`));
      console.log(`\n    Semak ejaan nama dalam jadual users dan kemaskini secara manual jika perlu.`);
    }

    console.log('\nMigrasi selesai.\n');
    process.exit(0);
  } catch (e) {
    console.error('\n[ERROR]', e.message);
    process.exit(1);
  }
})();
