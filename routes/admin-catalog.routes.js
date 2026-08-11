import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import { z } from 'zod';

import prisma from '../lib/prisma.js';
import requireAuth from '../middleware/require-auth.js';
import requireCsrf from '../middleware/require-csrf.js';
import requireRole from '../middleware/require-role.js';
import validateOrigin from '../middleware/validate-origin.js';
import { createSlug, createUniqueSlug } from '../utils/slug.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.join(__dirname, '..', 'site', 'uploads', 'products');

fs.mkdirSync(uploadDirectory, {
  recursive: true,
});

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: uploadDirectory,
  filename(req, file, callback) {
    const extension = MIME_EXTENSIONS[file.mimetype] || '';
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 6 * 1024 * 1024,
    files: 6,
  },
  fileFilter(req, file, callback) {
    if (!MIME_EXTENSIONS[file.mimetype]) {
      callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }

    callback(null, true);
  },
});

const productIdSchema = z.coerce.number().int().positive();
const categoryIdSchema = z.coerce.number().int().positive();

const productDataSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(140),
  categoryId: z.number().int().positive().nullable(),
  sku: z.string().trim().max(80).nullable(),
  brand: z.string().trim().max(100).nullable(),
  shortDescription: z.string().trim().max(240).nullable(),
  description: z.string().trim().max(5000).nullable(),
  specifications: z.string().trim().max(5000).nullable(),
  price: z.number().int().min(0).max(100000000).nullable(),
  priceFrom: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(-100000).max(100000),
  removeImageIds: z.array(z.number().int().positive()).max(6),
});

const categoryDataSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().max(120).optional().default(''),
    description: z.string().trim().max(300).nullable().optional(),
    sortOrder: z.number().int().min(-100000).max(100000).optional().default(0),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

function emptyToNull(value) {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return value === true || value === 'true' || value === 'on' || value === '1';
}

function parseRemoveImageIds(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

function parseProductBody(body) {
  const priceValue = String(body.price ?? '').trim();
  const categoryValue = String(body.categoryId ?? '').trim();
  const sortOrderValue = String(body.sortOrder ?? '0').trim();

  return productDataSchema.safeParse({
    name: String(body.name ?? ''),
    slug: String(body.slug ?? ''),
    categoryId: categoryValue ? Number(categoryValue) : null,
    sku: emptyToNull(body.sku),
    brand: emptyToNull(body.brand),
    shortDescription: emptyToNull(body.shortDescription),
    description: emptyToNull(body.description),
    specifications: emptyToNull(body.specifications),
    price: priceValue ? Number(priceValue) : null,
    priceFrom: parseBoolean(body.priceFrom),
    isActive: parseBoolean(body.isActive, true),
    sortOrder: sortOrderValue ? Number(sortOrderValue) : 0,
    removeImageIds: parseRemoveImageIds(body.removeImageIds),
  });
}

function storedPath(file) {
  return `/site/uploads/products/${file.filename}`;
}

function removeStoredPath(filePath) {
  const filename = path.basename(String(filePath || ''));

  if (!filename || filename === '.gitkeep') return;

  try {
    fs.rmSync(path.join(uploadDirectory, filename), {
      force: true,
    });
  } catch {
    // The database operation must remain successful even if an old file is already absent.
  }
}

function cleanupUploadedFiles(files = []) {
  files.forEach((file) => removeStoredPath(storedPath(file)));
}

function uploadImages(req, res, next) {
  upload.array('images', 6)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    cleanupUploadedFiles(req.files);

    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Одна из фотографий больше 6 МБ'
        : 'Можно загрузить до 6 фотографий JPG, PNG или WEBP';

    res.status(400).json({ message });
  });
}

async function resolveProductSlug({ requestedSlug, name, productId }) {
  const desired = createSlug(requestedSlug || name);

  return createUniqueSlug({
    value: desired,
    fallback: 'product',
    findExisting: async (slug) => {
      const product = await prisma.product.findFirst({
        where: {
          slug,
          ...(productId
            ? {
                id: {
                  not: productId,
                },
              }
            : {}),
        },
        select: {
          id: true,
        },
      });

      return Boolean(product);
    },
  });
}

async function resolveCategorySlug({ requestedSlug, name, categoryId }) {
  const desired = createSlug(requestedSlug || name);

  return createUniqueSlug({
    value: desired,
    fallback: 'category',
    findExisting: async (slug) => {
      const category = await prisma.productCategory.findFirst({
        where: {
          slug,
          ...(categoryId
            ? {
                id: {
                  not: categoryId,
                },
              }
            : {}),
        },
        select: {
          id: true,
        },
      });

      return Boolean(category);
    },
  });
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
});

router.use(requireAuth);
router.use(requireRole('OWNER'));

router.get('/', async (req, res, next) => {
  try {
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        orderBy: [
          {
            sortOrder: 'asc',
          },
          {
            createdAt: 'desc',
          },
        ],
        include: {
          category: true,
          images: {
            orderBy: {
              sortOrder: 'asc',
            },
          },
        },
      }),
      prisma.productCategory.findMany({
        orderBy: [
          {
            sortOrder: 'asc',
          },
          {
            name: 'asc',
          },
        ],
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      products,
      categories: categories.map(({ _count, ...category }) => ({
        ...category,
        productsCount: _count.products,
      })),
      counts: {
        all: products.length,
        active: products.filter((product) => product.isActive).length,
        hidden: products.filter((product) => !product.isActive).length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/categories',
  validateOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      const normalized = {
        name: req.body.name,
        slug: req.body.slug || '',
        description: emptyToNull(req.body.description),
        sortOrder: Number(req.body.sortOrder || 0),
        isActive: parseBoolean(req.body.isActive, true),
      };
      const parsed = categoryDataSchema.safeParse(normalized);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'Проверьте данные категории',
        });
      }

      const slug = await resolveCategorySlug({
        requestedSlug: parsed.data.slug,
        name: parsed.data.name,
      });
      const category = await prisma.productCategory.create({
        data: {
          ...parsed.data,
          description: parsed.data.description || null,
          slug,
        },
      });

      return res.status(201).json({ category });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  '/categories/:id',
  validateOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      const parsedId = categoryIdSchema.safeParse(req.params.id);
      const parsed = categoryDataSchema.safeParse({
        name: req.body.name,
        slug: req.body.slug || '',
        description: emptyToNull(req.body.description),
        sortOrder: Number(req.body.sortOrder || 0),
        isActive: parseBoolean(req.body.isActive, true),
      });

      if (!parsedId.success || !parsed.success) {
        return res.status(400).json({
          message: 'Проверьте данные категории',
        });
      }

      const existing = await prisma.productCategory.findUnique({
        where: {
          id: parsedId.data,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: 'Категория не найдена' });
      }

      const slug = await resolveCategorySlug({
        requestedSlug: parsed.data.slug,
        name: parsed.data.name,
        categoryId: parsedId.data,
      });
      const category = await prisma.productCategory.update({
        where: {
          id: parsedId.data,
        },
        data: {
          ...parsed.data,
          description: parsed.data.description || null,
          slug,
        },
      });

      return res.json({ category });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  '/categories/:id',
  validateOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      const parsedId = categoryIdSchema.safeParse(req.params.id);

      if (!parsedId.success) {
        return res.status(400).json({ message: 'Некорректная категория' });
      }

      const existing = await prisma.productCategory.findUnique({
        where: {
          id: parsedId.data,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: 'Категория не найдена' });
      }

      await prisma.productCategory.delete({
        where: {
          id: parsedId.data,
        },
      });

      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/products',
  validateOrigin,
  requireCsrf,
  uploadImages,
  async (req, res, next) => {
    try {
      const parsed = parseProductBody(req.body);

      if (!parsed.success) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ message: 'Проверьте данные товара' });
      }

      const { removeImageIds, slug: requestedSlug, ...data } = parsed.data;
      const slug = await resolveProductSlug({
        requestedSlug,
        name: data.name,
      });
      const product = await prisma.product.create({
        data: {
          ...data,
          slug,
          images: {
            create: (req.files || []).map((file, index) => ({
              path: storedPath(file),
              alt: data.name,
              sortOrder: index,
            })),
          },
        },
        include: {
          category: true,
          images: {
            orderBy: {
              sortOrder: 'asc',
            },
          },
        },
      });

      return res.status(201).json({ product });
    } catch (error) {
      cleanupUploadedFiles(req.files);
      return next(error);
    }
  },
);

router.patch(
  '/products/:id',
  validateOrigin,
  requireCsrf,
  uploadImages,
  async (req, res, next) => {
    try {
      const parsedId = productIdSchema.safeParse(req.params.id);
      const parsed = parseProductBody(req.body);

      if (!parsedId.success || !parsed.success) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({ message: 'Проверьте данные товара' });
      }

      const existing = await prisma.product.findUnique({
        where: {
          id: parsedId.data,
        },
        include: {
          images: true,
        },
      });

      if (!existing) {
        cleanupUploadedFiles(req.files);
        return res.status(404).json({ message: 'Товар не найден' });
      }

      const { removeImageIds, slug: requestedSlug, ...data } = parsed.data;
      const removableImages = existing.images.filter((image) =>
        removeImageIds.includes(image.id),
      );
      const remainingCount =
        existing.images.length - removableImages.length + (req.files || []).length;

      if (remainingCount > 6) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({
          message: 'У товара может быть не больше 6 фотографий',
        });
      }

      const slug = await resolveProductSlug({
        requestedSlug,
        name: data.name,
        productId: parsedId.data,
      });
      const nextSortOrder =
        existing.images.reduce(
          (maximum, image) => Math.max(maximum, image.sortOrder),
          -1,
        ) + 1;

      const product = await prisma.$transaction(async (tx) => {
        if (removableImages.length) {
          await tx.productImage.deleteMany({
            where: {
              id: {
                in: removableImages.map((image) => image.id),
              },
              productId: parsedId.data,
            },
          });
        }

        return tx.product.update({
          where: {
            id: parsedId.data,
          },
          data: {
            ...data,
            slug,
            images: {
              create: (req.files || []).map((file, index) => ({
                path: storedPath(file),
                alt: data.name,
                sortOrder: nextSortOrder + index,
              })),
            },
          },
          include: {
            category: true,
            images: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
        });
      });

      removableImages.forEach((image) => removeStoredPath(image.path));

      return res.json({ product });
    } catch (error) {
      cleanupUploadedFiles(req.files);
      return next(error);
    }
  },
);

router.delete(
  '/products/:id',
  validateOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      const parsedId = productIdSchema.safeParse(req.params.id);

      if (!parsedId.success) {
        return res.status(400).json({ message: 'Некорректный товар' });
      }

      const product = await prisma.product.findUnique({
        where: {
          id: parsedId.data,
        },
        include: {
          images: true,
        },
      });

      if (!product) {
        return res.status(404).json({ message: 'Товар не найден' });
      }

      await prisma.product.delete({
        where: {
          id: parsedId.data,
        },
      });

      product.images.forEach((image) => removeStoredPath(image.path));

      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
