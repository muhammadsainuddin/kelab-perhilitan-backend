export const messages = {
    ms: {
        emailExists: "E-mel ini telah didaftarkan.",
        registerSuccess: "Pendaftaran berjaya. Anda kini boleh log masuk.",
        serverError: "Ralat pelayan. Sila cuba sebentar lagi.",
        invalidCreds: "E-mel atau kata laluan tidak sah.",
        loginSuccess: "Log masuk berjaya.",
        noUser: "Tiada pengguna dengan e-mel ini.",
        resetEmailSent: "E-mel reset kata laluan telah dihantar.",
        emailFailed: "Gagal menghantar e-mel.",
        invalidToken: "Token tidak sah atau telah luput.",
        resetSuccess: "Kata laluan berjaya ditukar. Anda boleh log masuk sekarang.",
        
        // Kandungan E-mel
        emailSubject: "Kelab PERHILITAN — Tetapan Semula Kata Laluan",
        emailBody1: "Anda menerima e-mel ini kerana permohonan untuk menetapkan semula kata laluan akaun anda telah dibuat.",
        emailBody2: "Klik butang di bawah untuk mencipta kata laluan baru. Pautan ini hanya sah selama <strong>10 minit</strong> dan boleh digunakan sekali sahaja.",
        emailBtn: "Tetapkan Semula Kata Laluan",
        emailIgnore: "Jika anda tidak membuat permohonan ini, sila abaikan e-mel ini. Kata laluan anda tidak akan berubah."
    },
    en: {
        emailExists: "This email is already registered.",
        registerSuccess: "Registration successful. You can now log in.",
        serverError: "Server error. Please try again later.",
        invalidCreds: "Invalid email or password.",
        loginSuccess: "Login successful.",
        noUser: "No user found with this email.",
        resetEmailSent: "Password reset email has been sent.",
        emailFailed: "Failed to send email.",
        invalidToken: "Invalid or expired token.",
        resetSuccess: "Password reset successful. You can now log in.",
        
        // Email Content
        emailSubject: "Kelab PERHILITAN — Password Reset Request",
        emailBody1: "You are receiving this email because a password reset was requested for your account.",
        emailBody2: "Click the button below to create a new password. This link is valid for <strong>10 minutes</strong> and can only be used once.",
        emailBtn: "Reset My Password",
        emailIgnore: "If you did not request this, please ignore this email. Your password will remain unchanged."
    }
};

/**
 * Fungsi untuk mendapatkan bahasa dari request header
 * @param {Object} req - Express request object
 * @returns {String} 'en' atau 'ms'
 */
export const getLang = (req) => {
    // Dapatkan header 'accept-language' (contoh: 'en-US,en;q=0.9', 'ms-MY')
    const langHeader = req.headers['accept-language'];
    
    // Jika ia bermula dengan 'en', kembalikan Inggeris. Jika tidak, lalai (default) kepada Melayu.
    if (langHeader && langHeader.toLowerCase().startsWith('en')) {
        return 'en';
    }
    return 'ms';
};