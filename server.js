import express from 'express';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

app.use(express.static(__dirname));

const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    message: {
        success: false,
        message: 'Слишком много заявок. Попробуйте чуть позже.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

function cleanText(value, maxLength = 500) {
    return String(value || '')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');

    if (digits.length === 11 && digits.startsWith('8')) {
        return digits;
    }

    if (digits.length === 11 && digits.startsWith('7')) {
        return `8${digits.slice(1)}`;
    }

    if (digits.length === 10) {
        return `8${digits}`;
    }

    return '';
}

function isValidPhone(phone) {
    return /^89\d{9}$/.test(normalizePhone(phone));
}

function formatPhone(phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) return '';

    return `+7 (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`;
}

function makeTelLink(phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) return '';

    return `+7${normalized.slice(1)}`;
}

function buildEmailTemplate({ name, formattedPhone, telLink, service, comment, page, date }) {
    return `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Новая заявка Autocat19</title>
</head>
<body style="margin:0; padding:0; background:#090909; font-family:Arial, sans-serif; color:#ffffff;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#090909; padding:32px 12px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background:#111111; border:1px solid rgba(255,255,255,0.08); border-radius:20px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 32px 24px; background:linear-gradient(135deg,#151515 0%,#090909 100%); border-bottom:3px solid #d40000;">
                            <div style="font-size:13px; letter-spacing:3px; text-transform:uppercase; color:#d40000; margin-bottom:12px;">
                                AUTOCAT19 / ЗАЯВКА
                            </div>

                            <h1 style="margin:0; font-size:30px; line-height:1.15; text-transform:uppercase; color:#ffffff;">
                                Новая заявка<br>
                                <span style="color:#d40000;">с сайта</span>
                            </h1>

                            <p style="margin:16px 0 0; color:#bdbdbd; font-size:15px; line-height:1.6;">
                                Клиент оставил заявку через форму обратной связи.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:28px 32px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Имя
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 0 18px; color:#ffffff; font-size:22px; font-weight:700;">
                                        ${name}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Телефон
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 0 18px; color:#ffffff; font-size:22px; font-weight:700;">
                                        <a href="tel:${telLink}" style="color:#ffffff; text-decoration:none;">
                                            ${formattedPhone}
                                        </a>
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Услуга
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 0 18px;">
                                        <span style="display:inline-block; padding:10px 16px; border-radius:999px; background:#d40000; color:#ffffff; font-size:15px; font-weight:700;">
                                            ${service}
                                        </span>
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Комментарий
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0 18px; color:#d7d7d7; font-size:16px; line-height:1.7;">
                                        ${comment || '—'}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Страница
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0 18px; color:#d7d7d7; font-size:15px;">
                                        ${page || '—'}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.08); color:#8f8f8f; font-size:13px; text-transform:uppercase; letter-spacing:1px;">
                                        Дата
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 0 0; color:#d7d7d7; font-size:15px;">
                                        ${date}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:24px 32px 32px; background:#0b0b0b; border-top:1px solid rgba(255,255,255,0.08);">
                            <a href="tel:${telLink}" style="display:inline-block; padding:16px 24px; background:#d40000; color:#ffffff; text-decoration:none; border-radius:10px; font-size:16px; font-weight:700; text-transform:uppercase;">
                                Позвонить клиенту
                            </a>

                            <p style="margin:18px 0 0; color:#777777; font-size:13px; line-height:1.5;">
                                Письмо автоматически отправлено с сайта Autocat19.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
}

app.post('/send', sendLimiter, async (req, res) => {
    try {
        const name = cleanText(req.body.name, 60);
        const phone = cleanText(req.body.phone, 40);
        const service = cleanText(req.body.service, 100);
        const comment = cleanText(req.body.comment, 800);
        const page = cleanText(req.body.page, 200);

        if (!name || name.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Некорректное имя',
            });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({
                success: false,
                message: 'Некорректный телефон',
            });
        }

        if (!service) {
            return res.status(400).json({
                success: false,
                message: 'Не выбрана услуга',
            });
        }

        const formattedPhone = formatPhone(phone);
        const telLink = makeTelLink(phone);

        const date = new Date().toLocaleString('ru-RU', {
            timeZone: 'Asia/Krasnoyarsk',
        });

        const text = `
Новая заявка с сайта Autocat19

Имя: ${name}
Телефон: ${formattedPhone}
Услуга: ${service}
Комментарий: ${comment || '—'}
Страница: ${page || '—'}
Дата: ${date}
        `;

        const html = buildEmailTemplate({
            name,
            formattedPhone,
            telLink,
            service,
            comment,
            page,
            date,
        });

        await transporter.sendMail({
            from: `"Autocat19" <${process.env.SMTP_USER}>`,
            to: process.env.TO_EMAIL,
            subject: `Заявка Autocat19: ${service}`,
            text,
            html,
        });

        return res.json({
            success: true,
            message: 'Заявка отправлена',
        });
    } catch (error) {
        console.error('Send error:', error);

        return res.status(500).json({
            success: false,
            message: 'Ошибка сервера',
        });
    }
});

app.listen(PORT, () => {
    console.log(`Autocat19 server started on port ${PORT}`);
});