import db from '../config/db.js';

/**
 * Fungsi untuk menyimpan log ke pangkalan data
 * Ia dijalankan tanpa 'await' di peringkat pemanggil supaya tidak melambatkan response API
 */
const logToDB = async (level, method, endpoint, message, details = {}, ip_address = '') => {
    try {
        const query = `
            INSERT INTO system_logs (level, method, endpoint, message, details, ip_address) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        // Convert object 'details' kepada string JSON sebelum simpan
        const jsonDetails = JSON.stringify(details);

        await db.query(query, [level, method, endpoint, message, jsonDetails, ip_address]);
    } catch (error) {
        // Jika sistem log itu sendiri gagal, kita hanya print di console 
        // untuk elak server crash (infinite error loop)
        console.error("Gagal menyimpan log ke DB:", error);
    }
};

export default logToDB;