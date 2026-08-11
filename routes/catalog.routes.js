import express from 'express';
import { z } from 'zod';

import prisma from '../lib/prisma.js';

const router = express.Router();

const productsQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(120).optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

function getPublicCategoryWhere() {
  return {
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
  };
}

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          name: 'asc',
        },
      ],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: {
          select: {
            products: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      categories: categories.map(({ _count, ...category }) => ({
        ...category,
        productsCount: _count.products,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const parsed = productsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Некорректные параметры каталога',
      });
    }

    const { search, category, page, limit } = parsed.data;
    const where = {
      isActive: true,
      ...getPublicCategoryWhere(),
    };

    if (category) {
      where.category = {
        is: {
          slug: category,
          isActive: true,
        },
      };
    }

    if (search) {
      where.AND = [
        {
          OR: [
            {
              name: {
                contains: search,
              },
            },
            {
              sku: {
                contains: search,
              },
            },
            {
              brand: {
                contains: search,
              },
            },
            {
              shortDescription: {
                contains: search,
              },
            },
          ],
        },
      ];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [
          {
            sortOrder: 'asc',
          },
          {
            createdAt: 'desc',
          },
        ],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          brand: true,
          shortDescription: true,
          price: true,
          priceFrom: true,
          category: {
            select: {
              name: true,
              slug: true,
            },
          },
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
      }),
      prisma.product.count({ where }),
    ]);

    return res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();

    if (!slug || slug.length > 140) {
      return res.status(400).json({
        message: 'Некорректный адрес товара',
      });
    }

    const product = await prisma.product.findFirst({
      where: {
        slug,
        isActive: true,
        ...getPublicCategoryWhere(),
      },
      include: {
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({
        message: 'Товар не найден',
      });
    }

    const relatedProducts = await prisma.product.findMany({
      where: {
        id: {
          not: product.id,
        },
        categoryId: product.categoryId,
        isActive: true,
      },
      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
      take: 4,
      select: {
        id: true,
        name: true,
        slug: true,
        brand: true,
        shortDescription: true,
        price: true,
        priceFrom: true,
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
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

    return res.json({ product, relatedProducts });
  } catch (error) {
    return next(error);
  }
});

export default router;
