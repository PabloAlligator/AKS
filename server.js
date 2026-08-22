import 'dotenv/config';

import express from 'express';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
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

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { categoryId: null },
          { category: { is: { isActive: true } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: { slug: true, updatedAt: true },
    });
    const staticUrls = [
      ['https://autocat-abakan.ru/', '1.0'],
      ['https://autocat-abakan.ru/catalog', '0.9'],
      ['https://autocat-abakan.ru/udalenie-katalizatora.html', '0.9'],
    ];
    const entries = [
      ...staticUrls.map(([loc, priority]) => `<url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${priority}</priority></url>`),
      ...products.map((product) => `<url><loc>${escapeXml(`https://autocat-abakan.ru/catalog/${encodeURIComponent(product.slug)}`)}</loc><lastmod>${product.updatedAt.toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
    ];
    return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`);
  } catch (error) {
    return next(error);
  }
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

app.get('/cart.html', (req, res) => {
  return res.redirect(301, '/cart');
});

app.get('/cart', (req, res) => {
  return res.sendFile(path.join(__dirname, 'site', 'cart.html'));
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
        description: true,
        seoTitle: true,
        seoDescription: true,
        brand: true,
        sku: true,
        price: true,
        priceTo: true,
        images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { path: true } },
      },
    });

    if (!product) {
      return res.status(404).sendFile(path.join(__dirname, '404.html'));
    }

    const template = await readFile(
      path.join(__dirname, 'site', 'product.html'),
      'utf8',
    );
    const title = product.seoTitle || `${product.name} — купить в Абакане | Автокат Сервис`;
    const description =
      product.seoDescription || product.shortDescription || product.description?.slice(0, 165) ||
      `${product.name}. Оставьте заявку — менеджер AutoCat уточнит совместимость и подтвердит заказ.`;
    const canonical = `https://autocat-abakan.ru/catalog/${encodeURIComponent(slug)}`;
    const image = product.images?.[0]?.path
      ? `https://autocat-abakan.ru${product.images[0].path}`
      : 'https://autocat-abakan.ru/site/img/og-image.jpg';
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description,
      image: [image],
      url: canonical,
      ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.price !== null
        ? {
            offers: product.priceTo !== null
              ? {
                  '@type': 'AggregateOffer',
                  priceCurrency: 'RUB',
                  lowPrice: product.price,
                  highPrice: product.priceTo,
                  offerCount: 1,
                  availability: 'https://schema.org/InStock',
                  url: canonical,
                }
              : {
                  '@type': 'Offer',
                  priceCurrency: 'RUB',
                  price: product.price,
                  availability: 'https://schema.org/InStock',
                  url: canonical,
                },
          }
        : {}),
    };
    const html = template
      .replaceAll('{{PRODUCT_TITLE}}', escapeHtml(title))
      .replaceAll('{{PRODUCT_DESCRIPTION}}', escapeHtml(description))
      .replaceAll('{{PRODUCT_CANONICAL}}', escapeHtml(canonical))
      .replaceAll('{{PRODUCT_IMAGE}}', escapeHtml(image))
      .replaceAll('{{PRODUCT_STRUCTURED_DATA}}', JSON.stringify(structuredData).replaceAll('<', '\\u003c'));

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

const cartItemsSchema = z
  .array(
    z.object({
      productId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().min(1).max(99),
    }),
  )
  .min(1)
  .max(40)
  .superRefine((items, context) => {
    const ids = new Set();

    items.forEach((item, index) => {
      if (ids.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          message: 'Товар продублирован в корзине',
          path: [index, 'productId'],
        });
      }

      ids.add(item.productId);
    });
  });

async function getCurrentCart(rawItems) {
  const parsed = cartItemsSchema.safeParse(rawItems);

  if (!parsed.success) {
    return {
      success: false,
      status: 400,
      message: 'Корзина содержит некорректные товары',
    };
  }

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: parsed.data.map((item) => item.productId),
      },
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
      id: true,
      name: true,
      slug: true,
      price: true,
      priceTo: true,
      priceFrom: true,
      images: {
        orderBy: {
          sortOrder: 'asc',
        },
        take: 1,
        select: {
          path: true,
          alt: true,
        },
      },
    },
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  const unavailableProductIds = parsed.data
    .filter((item) => !productsById.has(item.productId))
    .map((item) => item.productId);
  const items = parsed.data.flatMap((item) => {
    const product = productsById.get(item.productId);

    if (!product) return [];

    return [
      {
        id: product.id,
        slug: product.slug,
        name: product.name,
        price: product.price,
        priceTo: product.priceTo,
        priceFrom: product.priceFrom,
        image: product.images[0] || null,
        quantity: item.quantity,
        lineTotal:
          product.price === null ? null : product.price * item.quantity,
      },
    ];
  });

  return {
    success: true,
    items,
    unavailableProductIds,
    total: items.reduce(
      (sum, item) => sum + (item.lineTotal === null ? 0 : item.lineTotal),
      0,
    ),
    hasRequestPrice: items.some((item) => item.price === null),
  };
}

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

async function handleLeadRequest(req, res) {
  try {
    const name = cleanText(req.body.name, 60);
    const phone = cleanText(req.body.phone, 40);
    const service = cleanText(req.body.service, 100);
    const comment = cleanText(req.body.comment, 5000);
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
}

app.post('/api/cart/quote', async (req, res) => {
  try {
    const quote = await getCurrentCart(req.body.items);

    if (!quote.success) {
      return res.status(quote.status).json({
        success: false,
        message: quote.message,
      });
    }

    return res.json(quote);
  } catch (error) {
    console.error('Cart quote error:', error);

    return res.status(500).json({
      success: false,
      message: 'Не удалось обновить корзину',
    });
  }
});

app.post('/api/cart/checkout', sendLimiter, async (req, res) => {
  try {
    const quote = await getCurrentCart(req.body.items);

    if (!quote.success) {
      return res.status(quote.status).json({
        success: false,
        message: quote.message,
      });
    }

    if (quote.unavailableProductIds.length) {
      return res.status(409).json({
        success: false,
        message: 'Один из товаров больше недоступен. Обновите корзину.',
        unavailableProductIds: quote.unavailableProductIds,
      });
    }

    const lines = quote.items.map((item, index) => {
      const price =
        item.price === null
          ? 'цена по запросу'
          : item.priceTo !== null
            ? `от ${new Intl.NumberFormat('ru-RU').format(item.price)} ₽ до ${new Intl.NumberFormat('ru-RU').format(item.priceTo)} ₽`
          : `${new Intl.NumberFormat('ru-RU').format(item.price)} ₽`;

      return `${index + 1}. ${item.name} — ${item.quantity} шт. (${price})`;
    });
    const car = cleanText(req.body.car, 120);
    const customerComment = cleanText(req.body.comment, 500);
    const totalText = quote.hasRequestPrice
      ? `Подтверждённая часть суммы: ${new Intl.NumberFormat('ru-RU').format(quote.total)} ₽`
      : `Итого: ${new Intl.NumberFormat('ru-RU').format(quote.total)} ₽`;
    const serverComment = [
      `Товары по актуальным ценам:\n${lines.join('\n')}`,
      totalText,
      car ? `Автомобиль: ${car}` : '',
      customerComment ? `Комментарий: ${customerComment}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    req.body = {
      name: req.body.name,
      phone: req.body.phone,
      service: `Заказ из корзины: ${quote.items.reduce((sum, item) => sum + item.quantity, 0)} шт.`,
      comment: serverComment,
      page: '/cart',
      website: req.body.website,
    };

    return handleLeadRequest(req, res);
  } catch (error) {
    console.error('Cart checkout error:', error);

    return res.status(500).json({
      success: false,
      message: 'Не удалось проверить товары перед заказом',
    });
  }
});

app.post('/send', sendLimiter, handleLeadRequest);

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
