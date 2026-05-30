import db from '../config/db.js';

// ==========================================
// 1. Semak Profil & Status Keahlian Kelab
// ==========================================
export const checkStatus = async (req, res) => {
    const no_kp = req.user.no_kp; 

    try {
        // TUKAR: k.penempatan kepada k.nama_majikan
        // Kita guna "AS penempatan" supaya jika frontend cari 'penempatan', ia masih berfungsi
        const query = `
            SELECT k.nama_penuh, k.nama_majikan AS penempatan, k.yuran_bulanan, k.status_ahli, k.no_ahli, k.pilihan_potongan
            FROM keahlian_kelab k
            WHERE k.no_kp = ?
        `;
        const [ahli] = await db.query(query, [no_kp]);

        if (ahli.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Anda belum mendaftar sebagai ahli kelab. Sila isi borang keahlian." 
            });
        }

        res.status(200).json({
            success: true,
            data: ahli[0] 
        });

    } catch (error) {
        console.error("Semak Status Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 2. Mohon Bantuan Kebajikan
// ==========================================
export const mohonBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { jenis_bantuan, keterangan } = req.body;
    
    // Jika ada sistem upload fail sokongan, kita akan ambil dari req.file
    const dokumen_sokongan = req.file ? req.file.filename : null; 

    try {
        const query = `
            INSERT INTO bantuan_kebajikan (no_kp, jenis_bantuan, keterangan, dokumen_sokongan) 
            VALUES (?, ?, ?, ?)
        `;
        await db.query(query, [no_kp, jenis_bantuan, keterangan, dokumen_sokongan]);

        res.status(201).json({ 
            success: true, 
            message: "Permohonan Bantuan Kebajikan berjaya dihantar dan sedang diproses." 
        });

    } catch (error) {
        console.error("Mohon Bantuan Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. Mohon Berhenti Ahli
// ==========================================
export const mohonBerhenti = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { sebab_berhenti } = req.body;

    try {
        const query = `INSERT INTO berhenti_ahli (no_kp, sebab_berhenti) VALUES (?, ?)`;
        await db.query(query, [no_kp, sebab_berhenti]);

        res.status(201).json({ 
            success: true, 
            message: "Permohonan berhenti ahli telah dihantar kepada urusetia." 
        });

    } catch (error) {
        console.error("Mohon Berhenti Error:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};