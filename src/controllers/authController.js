import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sendEmail from '../utils/sendEmail.js';
import { messages, getLang } from '../utils/lang.js';

// ==========================================
// 1. Pendaftaran / Pengaktifan Akaun
// ==========================================
export const register = async (req, res) => {
    const { no_kp, email, password, no_tel } = req.body;

    // 0. Validasi input sisi pelayan (jangan bergantung pada frontend sahaja)
    if (!no_kp || !email || !password) {
        return res.status(400).json({ message: "No. Kad Pengenalan, e-mel dan kata laluan wajib diisi." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Format e-mel tidak sah." });
    }
    if (String(password).length < 8) {
        return res.status(400).json({ message: "Kata laluan mestilah sekurang-kurangnya 8 aksara." });
    }

    try {
        // 1. Semak jika kakitangan wujud dalam jadual users (berdasarkan import CSV)
        const [users] = await db.query('SELECT * FROM users WHERE no_kp = ?', [no_kp]);
        if (users.length === 0) {
            return res.status(403).json({ message: "Maaf, No. Kad Pengenalan ini tiada dalam rekod kakitangan Perhilitan." });
        }

        const user = users[0];

        // 2. Semak jika akaun telah diaktifkan sebelum ini (ada password)
        if (user.password !== null) {
            return res.status(400).json({ message: "Akaun untuk No. Kad Pengenalan ini telah diaktifkan. Sila log masuk." });
        }
        
        // 3. Semak jika emel telah digunakan oleh kakitangan lain
        const [existingEmail] = await db.query('SELECT id FROM users WHERE emel = ? AND no_kp != ?', [email, no_kp]);
        if (existingEmail.length > 0) {
            return res.status(400).json({ message: "E-mel ini telah didaftarkan oleh pengguna lain." });
        }

        // 4. Hash kata laluan
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 5. Kemaskini jadual users (masukkan emel, no_tel, password dan set aktif)
        const queryUpdate = `
            UPDATE users 
            SET emel = ?, phone = ?, password = ?, status_ahli = 'aktif' 
            WHERE no_kp = ?
        `;
        await db.query(queryUpdate, [email, no_tel, hashedPassword, no_kp]);

        res.status(201).json({ message: "Pendaftaran berjaya! Akaun anda telah diaktifkan, sila log masuk." });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: "Ralat pelayan semasa pendaftaran." });
    }
};

// ==========================================
// 2. Log Masuk (Login)
// ==========================================
export const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Carian dibuat berdasarkan 'emel' di dalam jadual 'users', join dengan 'penempatan'
        const query = `
            SELECT u.id, u.no_kp, u.password, u.role, u.status_ahli, u.nama_pegawai, p.nama_penempatan 
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.emel = ?
        `;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "E-mel atau kata laluan salah." });
        }

        // Semak status ahli (aktif / tidak aktif)
        if (user.status_ahli === 'tidak aktif') {
            return res.status(403).json({ message: "Akaun anda tidak aktif. Sila hubungi Admin." });
        }

        const token = jwt.sign({ id: user.id, role: user.role, no_kp: user.no_kp }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            message: "Berjaya log masuk.",
            token,
            user: { id: user.id, no_kp: user.no_kp, name: user.nama_pegawai, role: user.role, penempatan: user.nama_penempatan }
        });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. Lupa Kata Laluan (Forgot Password)
// ==========================================
export const forgotPassword = async (req, res) => {
    // Pengendalian fungsi bahasa jika wujud
    let msg = { noUser: "E-mel tidak dijumpai.", emailSubject: "Tukar Kata Laluan", resetEmailSent: "E-mel tetapan semula dihantar.", emailFailed: "Gagal menghantar e-mel." };
    try {
        const lang = getLang ? getLang(req) : 'ms';
        if (messages && messages[lang]) msg = messages[lang];
    } catch(e) {}

    const { email } = req.body;

    try {
        // Carian terus menggunakan jadual users
        const query = `SELECT id, emel AS email FROM users WHERE emel = ?`;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        // Elak user enumeration: jangan dedahkan sama ada e-mel wujud.
        // Balas mesej generik yang sama; hanya hantar e-mel jika user benar-benar wujud.
        if (!user) {
            return res.status(200).json({ message: msg.resetEmailSent });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

        await db.query('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [hashedResetToken, expiryTime, user.id]);

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        
        const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #0F4C3A; padding: 20px; text-align: center; color: white;">
                <h2 style="margin: 0;">Reset Kata Laluan</h2>
            </div>
            <div style="padding: 20px; color: #333; line-height: 1.6;">
                <p>Klik pautan di bawah untuk reset kata laluan anda. Pautan ini sah selama 10 minit.</p>
                <div style="text-align: center; margin: 20px 0;">
                    <a href="${resetUrl}" style="background-color: #E30613; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Kata Laluan</a>
                </div>
            </div>
        </div>`;

        await sendEmail({ email: user.email, subject: msg.emailSubject, message: emailTemplate });
        res.status(200).json({ message: msg.resetEmailSent });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ message: msg.emailFailed });
    }
};

// ==========================================
// 4. Tetapkan Semula Kata Laluan (Reset Password)
// ==========================================
export const resetPassword = async (req, res) => {
    let msg = { invalidToken: "Token tidak sah atau telah tamat tempoh.", resetSuccess: "Kata laluan berjaya ditukar.", serverError: "Ralat pelayan." };
    try {
        const lang = getLang ? getLang(req) : 'ms';
        if (messages && messages[lang]) msg = messages[lang];
    } catch(e) {}

    const { token } = req.params;
    const { newPassword } = req.body;

    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const [users] = await db.query('SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()', [hashedToken]);
        const user = users[0];

        if (!user) return res.status(400).json({ message: msg.invalidToken });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', [hashedPassword, user.id]);

        res.status(200).json({ message: msg.resetSuccess });
    } catch (error) {
        res.status(500).json({ message: msg.serverError });
    }
};