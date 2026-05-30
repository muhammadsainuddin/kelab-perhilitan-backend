import db from '../config/db.js';

// ==========================================
// Ahli: Hantar Permohonan Bantuan
// ==========================================
export const mohonBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { jenis_bantuan, keterangan } = req.body;
    
    // Memandangkan frontend menghantar pelbagai fail (Maksimum 20), kita gunakan req.files
    let dokumenArray = [];
    
    if (req.files && req.files.length > 0) {
        // Ekstrak hanya nama fail yang telah disimpan oleh multer
        dokumenArray = req.files.map(file => file.filename);
    }
    
    // Tukar array nama fail menjadi format teks JSON untuk disimpan ke dalam database
    const dokumenString = dokumenArray.length > 0 ? JSON.stringify(dokumenArray) : null;

    try {
        await db.query(
            `INSERT INTO bantuan_kebajikan (no_kp, jenis_bantuan, keterangan, dokumen_sokongan) VALUES (?, ?, ?, ?)`,
            [no_kp, jenis_bantuan, keterangan, dokumenString]
        );
        res.status(201).json({ success: true, message: "Permohonan bantuan berjaya dihantar kepada Urusetia." });
    } catch (error) {
        console.error("Ralat Mohon Bantuan:", error);
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan." });
    }
};

// ==========================================
// Ahli: Lihat Sejarah Permohonan Sendiri
// ==========================================
export const sejarahBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    
    try {
        const [sejarah] = await db.query(
            `SELECT * FROM bantuan_kebajikan WHERE no_kp = ? ORDER BY tarikh_mohon DESC`,
            [no_kp]
        );
        
        // Parse semula rentetan teks JSON kepada bentuk Array supaya mudah dibaca oleh Frontend
        const formattedSejarah = sejarah.map(item => {
            let senaraiDokumen = [];
            if (item.dokumen_sokongan) {
                try {
                    senaraiDokumen = JSON.parse(item.dokumen_sokongan);
                } catch (e) {
                    // Fallback jika rekod lama tidak menggunakan format JSON (hanya ada 1 fail)
                    senaraiDokumen = [item.dokumen_sokongan];
                }
            }
            
            return {
                ...item,
                dokumen_sokongan: senaraiDokumen // Sekarang ia sentiasa dalam format Array
            };
        });

        res.status(200).json({ success: true, data: formattedSejarah });
    } catch (error) {
        console.error("Ralat Sejarah Bantuan:", error);
        res.status(500).json({ success: false, message: "Ralat memuatkan sejarah permohonan." });
    }
};