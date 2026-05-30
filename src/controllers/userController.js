import db from '../config/db.js';
import bcrypt from 'bcryptjs';

// ==========================================
// 1. Ambil Profil & Logik Sekatan Yuran Tertunggak
// ==========================================
export const getMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const user_id = req.user.id;

    try {
        const query = `
            SELECT 
                u.no_kp, 
                u.nama_pegawai AS nama_penuh, 
                u.gred_penyandang_sspa AS gred_sspa, 
                p.nama_penempatan AS penempatan, 
                u.emel AS email, 
                u.phone AS no_tel, 
                u.saiz_baju, 
                u.jenis_potongan AS pilihan_potongan, 
                u.yuran_kelab_bulanan,
                u.no_akaun_bank AS no_acc_bank, 
                u.nama_bank AS bank_ahli,
                u.nama_waris, 
                u.no_phone_waris AS no_tel_waris, 
                u.akaun_bank_waris AS no_acc_waris,
                u.nama_bank_waris AS bank_waris,
                u.status_ahli, 
                u.gambar, 
                u.role
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui." });
        }

        let profil = rows[0];
        const currentYear = new Date().getFullYear();

        // 1. Semak rekod transaksi bayaran tahun ini dari database
        const [bayaran] = await db.query(`
            SELECT MAX(YEAR(tarikh_selesai)) as last_paid_year 
            FROM transaksi_pembayaran 
            WHERE user_id = ? AND status_bayaran = 'berjaya'
        `, [user_id]);

        const lastPaidYear = bayaran[0].last_paid_year;

        // 2. Tentukan status tunggakan yuran secara dinamik (Cegah Hack Frontend)
        let yuranTertunggak = false;
        
        // Sekatan hanya terpakai untuk kaedah bayaran manual / FPX sahaja
        if (profil.pilihan_potongan === 'Bayar secara manual' || profil.pilihan_potongan === 'FPX') {
            if (!lastPaidYear || lastPaidYear < currentYear) {
                yuranTertunggak = true;
            }
        }

        // 3. Setkan flag keselamatan untuk dihantar ke Vue
        // Akaun dalam DB tidak diubah (tetap aktif), cuma akses modul disekat melalui flag ini
        profil.yuran_tertunggak = yuranTertunggak;
        
        // Kita paksa is_paid = false jika tertunggak supaya fail Aktiviti & Bantuan automatik menyekat akses!
        profil.is_paid = !yuranTertunggak; 
        profil.status_yuran = yuranTertunggak ? 'YURAN TERTUNGGAK' : 'AHLI BERBAYAR';

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil." });
    }
};

// ==========================================
// 2. Kemaskini Profil
// ==========================================
export const updateMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { 
        email, no_tel, saiz_baju, nama_waris, no_tel_waris,
        no_acc_waris, bank_waris, penempatan_id,
        no_acc_bank, bank_ahli
    } = req.body;

    try {
        const query = `
            UPDATE users 
            SET emel = ?, 
                phone = ?, 
                saiz_baju = IFNULL(?, saiz_baju), 
                nama_waris = IFNULL(?, nama_waris), 
                no_phone_waris = IFNULL(?, no_phone_waris), 
                akaun_bank_waris = IFNULL(?, akaun_bank_waris),
                nama_bank_waris = IFNULL(?, nama_bank_waris), 
                penempatan_id = IFNULL(?, penempatan_id), 
                no_akaun_bank = IFNULL(?, no_akaun_bank),
                nama_bank = IFNULL(?, nama_bank)
            WHERE no_kp = ?
        `;
        
        await db.query(query, [
            email, no_tel, saiz_baju, nama_waris, no_tel_waris,
            no_acc_waris, bank_waris, penempatan_id, 
            no_acc_bank, bank_ahli, no_kp
        ]);

        // Jika user nak tukar password dari profil
        if (req.body.kata_laluan) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(req.body.kata_laluan, saltRounds);
            await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashedPassword, no_kp]);
        }

        res.status(200).json({ success: true, message: "Maklumat profil anda berjaya dikemas kini." });
    } catch (error) {
        console.error("Ralat Kemaskini Profil:", error);
        res.status(500).json({ success: false, message: "Gagal mengemaskini profil." });
    }
};

// ==========================================
// 3. Tarik Senarai PTJ (Lokasi Penempatan)
// ==========================================
export const getSenaraiPTJ = async (req, res) => {
    try {
        // Ambil terus dari jadual penempatan
        const [ptj] = await db.query('SELECT id, nama_penempatan FROM penempatan ORDER BY nama_penempatan ASC');
        res.status(200).json({ success: true, data: ptj });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik senarai PTJ." });
    }
};

// ==========================================
// 4. Permohonan Berhenti Ahli
// ==========================================
export const applyResignation = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { sebab_berhenti } = req.body;

    try {
        // Simpan log dalam table berhenti_ahli (Anda perlu pastikan table ini wujud dalam DB anda)
        const createTableBerhenti = `
            CREATE TABLE IF NOT EXISTS berhenti_ahli (
                id INT AUTO_INCREMENT PRIMARY KEY,
                no_kp VARCHAR(20),
                sebab_berhenti TEXT,
                status_permohonan VARCHAR(50) DEFAULT 'MENUNGGU',
                tarikh_mohon DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        await db.query(createTableBerhenti);

        await db.query(`INSERT INTO berhenti_ahli (no_kp, sebab_berhenti) VALUES (?, ?)`, [no_kp, sebab_berhenti]);
        
        // Terus tukar status dalam jadual users
        await db.query(`UPDATE users SET status_ahli = 'tidak aktif' WHERE no_kp = ?`, [no_kp]);

        res.status(200).json({ success: true, message: "Permohonan berhenti telah dihantar. Status akaun anda kini tidak aktif." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan berhenti." });
    }
};

// ==========================================
// 5. Tukar Password
// ==========================================
export const changePassword = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { oldPassword, newPassword } = req.body;

    try {
        const [user] = await db.query(`SELECT password FROM users WHERE no_kp = ?`, [no_kp]);
        
        const isMatch = await bcrypt.compare(oldPassword, user[0].password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Kata laluan lama salah." });

        const hashed = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashed, no_kp]);

        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menukar kata laluan." });
    }
};

// ==========================================
// 6. Muat Naik Gambar Profil (Auto Upload)
// ==========================================
export const updateGambarProfil = async (req, res) => {
    const no_kp = req.user.no_kp;
    
    if (!req.file) return res.status(400).json({ success: false, message: "Tiada fail gambar dijumpai." });
    
    try {
        await db.query(`UPDATE users SET gambar = ? WHERE no_kp = ?`, [req.file.filename, no_kp]);
        res.status(200).json({ success: true, message: "Gambar profil berjaya dikemas kini!", gambar: req.file.filename });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menyimpan gambar. Sila cuba lagi." });
    }
};