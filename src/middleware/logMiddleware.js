import logToDB from '../utils/logger.js';
import eventBus from '../utils/eventEmitter.js'; // Import Event Bus

export const requestLogger = (req, res, next) => {
    // 1. Simpan fungsi asal res.json
    const originalJson = res.json;

    // 2. Tulis ganti (override) res.json untuk tangkap mesej sebelum ia dihantar ke pengguna
    res.json = function (body) {
        res.locals.responseBody = body; // Simpan mesej dalam res.locals
        return originalJson.call(this, body); // Hantar seperti biasa
    };

    res.on('finish', () => {
        // Dapatkan mesej yang dipintas tadi (jika ada)
        const responseBody = res.locals.responseBody || {};
        const apiMessage = responseBody.message || 'Selesai';
        const statusCode = res.statusCode;

        const details = {
            requestBody: req.body,
            responseBody: responseBody,
            statusCode: statusCode
        };

        if (details.requestBody && details.requestBody.password) {
            details.requestBody.password = '***DISEMBUNYIKAN***';
        }

        // 3. Simpan ke Database SQL
        logToDB('INFO', req.method, req.originalUrl, `[${statusCode}] ${apiMessage}`, details, req.ip);

        // 4. Tentukan Jenis & Warna untuk Dashboard
        let jenis = 'INFO';
        let warna = '#17a2b8'; // Biru (Default)

        if (statusCode >= 200 && statusCode < 300) {
            jenis = 'BERJAYA';
            warna = '#28a745'; // Hijau
        } else if (statusCode >= 400 && statusCode < 500) {
            jenis = 'AMARAN/GAGAL';
            warna = '#ffc107'; // Kuning (Contoh: Emel duplicate, salah password)
        } else if (statusCode >= 500) {
            jenis = 'RALAT';
            warna = '#dc3545'; // Merah
        }

        // 5. Pancarkan (Emit) ke Dashboard HTML
        // Kita elakkan log SSE /api/stream dipancarkan semula ke dashboard untuk elak 'spam'
        if (!req.originalUrl.includes('/api/stream')) {
            eventBus.emit('aktiviti_baharu', {
                jenis: jenis,
                warna: warna,
                kaedah: req.method,
                endpoint: req.originalUrl,
                statusKOD: statusCode,
                mesej: apiMessage,
                masa: new Date().toLocaleTimeString('ms-MY')
            });
        }
    });

    next();
};

export const errorLogger = (err, req, res, next) => {
    const details = {
        body: req.body,
        stackTrace: err.stack
    };

    if (details.body && details.body.password) {
        details.body.password = '***DISEMBUNYIKAN***';
    }

    logToDB('ERROR', req.method, req.originalUrl, err.message, details, req.ip);

    // Pancarkan ralat kritikal ke Dashboard
    eventBus.emit('aktiviti_baharu', {
        jenis: 'RALAT SISTEM',
        warna: '#dc3545',
        kaedah: req.method,
        endpoint: req.originalUrl,
        statusKOD: 500,
        mesej: err.message,
        masa: new Date().toLocaleTimeString('ms-MY')
    });

    res.status(500).json({ 
        message: "Ralat pelayan dalaman berlaku. Isu ini telah direkodkan." 
    });
};