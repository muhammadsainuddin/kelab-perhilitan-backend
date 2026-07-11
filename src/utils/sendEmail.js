import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { KELAB } from '../config/kelab.js';

dotenv.config();

// 1. Cipta transporter DI LUAR fungsi (untuk prestasi yang lebih pantas)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmail = async (options) => {
    const mailOptions = {
        from: `"${KELAB.namaPendek}" <${process.env.EMAIL_USER}>`,
        to: options.email,
        subject: options.subject,
        html: options.message,
        ...(options.cc ? { cc: options.cc } : {}),
    };

    await transporter.sendMail(mailOptions);
};

export default sendEmail;