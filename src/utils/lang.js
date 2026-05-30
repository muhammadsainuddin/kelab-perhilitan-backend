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
        emailSubject: "GeoRanger TNPP - Reset Kata Laluan",
        emailTitle: "Reset Kata Laluan GeoRanger TNPP",
        emailBody1: "Anda menerima e-mel ini kerana anda (atau seseorang) memohon untuk menukar kata laluan.",
        emailBody2: "Sila klik pautan di bawah untuk menetapkan semula kata laluan anda. Pautan ini sah selama 10 minit.",
        emailBtn: "Reset Kata Laluan Saya",
        emailIgnore: "Jika anda tidak memohon, sila abaikan e-mel ini."
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
        emailSubject: "GeoRanger TNPP - Password Reset",
        emailTitle: "GeoRanger TNPP Password Reset",
        emailBody1: "You are receiving this email because you (or someone else) requested a password reset.",
        emailBody2: "Please click the link below to reset your password. This link is valid for 10 minutes.",
        emailBtn: "Reset My Password",
        emailIgnore: "If you did not request this, please ignore this email."
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