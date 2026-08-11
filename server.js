import 'dotenv/config';

import express from 'express';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.routes.js';
import adminCatalogRoutes from './routes/admin-catalog.routes.js';
import adminRoutes from './routes/admin.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import requireAuth from './middleware/require-auth.js';
import requireRole from './middleware/require-role.js';
import { buildLeadSearchText } from './utils/search.js';
import prisma from './lib/prisma.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(cookieParser());

app.use('/admin/api/auth', authRoutes);
app.use('/admin/api/catalog', adminCatalogRoutes);
app.use('/admin/api', adminRoutes);
app.use('/api/catalog', catalogRoutes);

function sendAdminPage(fileName) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');

    return res.sendFile(path.join(__dirname, 'admin-pages', fileName));
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// админка

app.get('/admin/login', sendAdminPage('login.html'));

app.get('/admin', requireAuth.page, (req, res) => {
  const target =
    req.auth.user.role === 'OWNER' ? '/admin/dashboard' : '/admin/requests';

  return res.redirect(303, target);
});

app.get(
  '/admin/dashboard',
  requireAuth.page,
  requireRole.page('OWNER'),
  sendAdminPage('dashboard.html'),
);

app.get('/admin/requests', requireAuth.page, sendAdminPage('requests.html'));

app.get(
  '/admin/catalog',
  requireAuth.page,
  requireRole.page('OWNER'),
  sendAdminPage('catalog.html'),
);

app.get(
  '/admin/staff',
  requireAuth.page,
  requireRole.page('OWNER'),
  sendAdminPage('staff.html'),
);

// публичные файлы

app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
  return res.redirect(301, '/');
});

app.get('/robots.txt', (req, res) => {
  return res.sendFile(path.join(__dirname, 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  return res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/404.html', (req, res) => {
  return res.sendFile(path.join(__dirname, '404.html'));
});

app.get('/site/udalenie-katalizatora.html', (req, res) => {
  return res.redirect(301, '/udalenie-katalizatora.html');
});

app.get('/udalenie-katalizatora.html', (req, res) => {
  return res.sendFile(
    path.join(__dirname, 'site', 'udalenie-katalizatora.html'),
  );
});

app.get('/catalog.html', (req, res) => {
  return res.redirect(301, '/catalog');
});

app.get('/catalog', (req, res) => {
  return res.sendFile(path.join(__dirname, 'site', 'catalog.html'));
});

app.get('/site/catalog.html', (req, res) => {
  return res.redirect(301, '/catalog');
});

app.get('/site/product.html', (req, res) => {
  return res.redirect(301, '/catalog');
});

app.get('/catalog/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const product = await prisma.product.findFirst({
      where: {
        slug,
        isActive: true,
        OR: [
          {
            categoryId: null,
          },
          {
            category: {
              is: {
                isActive: true,
              },
            },
          },
        ],
      },
      select: {
        name: true,
        shortDescription: true,
      },
    });

    if (!product) {
      return res.status(404).sendFile(path.join(__dirname, '404.html'));
    }

    const template = await readFile(
      path.join(__dirname, 'site', 'product.html'),
      'utf8',
    );
    const title = `${product.name} — каталог Автокат Сервис`;
    const description =
      product.shortDescription ||
      `${product.name}. Оставьте заявку — менеджер AutoCat уточнит совместимость и подтвердит заказ.`;
    const canonical = `https://autocat-abakan.ru/catalog/${encodeURIComponent(slug)}`;
    const html = template
      .replaceAll('{{PRODUCT_TITLE}}', escapeHtml(title))
      .replaceAll('{{PRODUCT_DESCRIPTION}}', escapeHtml(description))
      .replaceAll('{{PRODUCT_CANONICAL}}', escapeHtml(canonical));

    return res.type('html').send(html);
  } catch (error) {
    return next(error);
  }
});

app.use(
  '/site',
  express.static(path.join(__dirname, 'site'), {
    index: false,
    dotfiles: 'deny',
  }),
);

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

transporter.verify((error) => {
  if (error) {
    console.error('SMTP ошибка:', error);
  } else {
    console.log('SMTP готов к отправке писем');
  }
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

function buildEmailTemplate({
  name,
  formattedPhone,
  telLink,
  service,
  comment,
  page,
  date,
}) {
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
    const website = cleanText(req.body.website, 200);

    // антиспам-поле

    if (website) {
      return res.json({
        success: true,
        message: 'Заявка отправлена',
      });
    }

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

    const normalizedPhone = normalizePhone(phone);
    const formattedPhone = formatPhone(normalizedPhone);
    const telLink = makeTelLink(normalizedPhone);

    const source = cleanText(
      page || req.get('referer') || 'Сайт Autocat19',
      200,
    );

    const date = new Date().toLocaleString('ru-RU', {
      timeZone: 'Asia/Krasnoyarsk',
    });

    // сохраняем заявку

    const lead = await prisma.lead.create({
      data: {
        name,
        phone: normalizedPhone,
        service,
        message: comment || null,
        source: source || null,

        searchText: buildLeadSearchText({
          name,
          phone: normalizedPhone,
          service,
          message: comment,
          source,
          internalComment: null,
        }),

        status: 'NEW',
        emailSent: false,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    console.log('🔥 Новая заявка сохранена:', {
      id: lead.id,
      name,
      phone: formattedPhone,
      service,
      comment: comment || '—',
      source: source || '—',
      date,
      ip: req.ip,
    });

    const text = `
Новая заявка с сайта Autocat19

Номер заявки: ${lead.id}
Имя: ${name}
Телефон: ${formattedPhone}
Услуга: ${service}
Комментарий: ${comment || '—'}
Страница: ${source || '—'}
Дата: ${date}
    `;

    const html = buildEmailTemplate({
      name,
      formattedPhone,
      telLink,
      service,
      comment,
      page: source,
      date,
    });

    // отправка письма не влияет на сохранение заявки

    try {
      await transporter.sendMail({
        from: `"Autocat19" <${process.env.SMTP_USER}>`,
        to: process.env.TO_EMAIL,
        subject: `Заявка №${lead.id} Autocat19: ${service}`,
        text,
        html,
      });

      await prisma.lead.update({
        where: {
          id: lead.id,
        },
        data: {
          emailSent: true,
        },
      });
    } catch (mailError) {
      console.error(
        `Не удалось отправить письмо по заявке №${lead.id}:`,
        mailError,
      );
    }

    return res.json({
      success: true,
      message: 'Заявка принята',
    });
  } catch (error) {
    console.error('Send error:', error);

    return res.status(500).json({
      success: false,
      message: 'Не удалось сохранить заявку',
    });
  }
});

// ошибки

app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: 'Внутренняя ошибка сервера',
  });
});

app.listen(PORT, () => {
  console.log(`Autocat19 запущен: http://localhost:${PORT}`);
});
