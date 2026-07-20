import express from 'express';
import argon2 from 'argon2';
import { z } from 'zod';

import prisma from '../lib/prisma.js';

import requireAuth from '../middleware/require-auth.js';
import requireRole from '../middleware/require-role.js';
import requireCsrf from '../middleware/require-csrf.js';
import { buildLeadSearchText, normalizeSearchText } from '../utils/search.js';
import validateOrigin from '../middleware/validate-origin.js';

const router = express.Router();

const LEAD_STATUSES = ['NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const leadStatusSchema = z.enum(LEAD_STATUSES);

const leadIdSchema = z.coerce.number().int().positive();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const staffIdSchema = z.coerce.number().int().positive();

const staffNameSchema = z.string().trim().min(2).max(80);

const staffEmailSchema = z.string().trim().toLowerCase().email().max(254);

const staffPasswordSchema = z.string().min(10).max(128);

const createStaffSchema = z
  .object({
    name: staffNameSchema,
    email: staffEmailSchema,
    password: staffPasswordSchema,
  })
  .strict();

const updateStaffSchema = z
  .object({
    name: staffNameSchema.optional(),
    email: staffEmailSchema.optional(),
    password: staffPasswordSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.password !== undefined ||
      data.isActive !== undefined,
    {
      message: 'Не переданы изменения',
    },
  );

const staffSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,

  _count: {
    select: {
      assignedLeads: true,
    },
  },
};

function createStaffResponse(user) {
  const { _count, ...staff } = user;

  return {
    ...staff,

    assignedLeadsCount: _count?.assignedLeads || 0,
  };
}

const leadsQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(leadStatusSchema.optional()),

  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),

  dateFrom: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),

  dateTo: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),

  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(50).default(12),
});

const updateLeadSchema = z
  .object({
    status: leadStatusSchema.optional(),

    internalComment: z.string().trim().max(2000).nullable().optional(),

    assignedToId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.status !== undefined ||
      data.internalComment !== undefined ||
      data.assignedToId !== undefined,
    {
      message: 'Не переданы изменения',
    },
  );

function parseDate(value, endOfDay = false) {
  if (!value) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';

  const date = new Date(`${value}T${time}+07:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function buildLeadWhere({ status, search, dateFrom, dateTo }) {
  const where = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    where.searchText = {
      contains: normalizeSearchText(search),
    };
  }

  const startDate = parseDate(dateFrom);
  const endDate = parseDate(dateTo, true);

  if (startDate || endDate) {
    where.createdAt = {};

    if (startDate) {
      where.createdAt.gte = startDate;
    }

    if (endDate) {
      where.createdAt.lte = endDate;
    }
  }

  return where;
}

async function getLeadCounts() {
  const grouped = await prisma.lead.groupBy({
    by: ['status'],
    _count: {
      _all: true,
    },
  });

  const counts = {
    all: 0,
    NEW: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };

  for (const item of grouped) {
    counts[item.status] = item._count._all;
    counts.all += item._count._all;
  }

  return counts;
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  next();
});

router.use(requireAuth);

// dashboard

router.get('/dashboard', requireRole('OWNER'), async (req, res, next) => {
  try {
    const [counts, latestLeads, activeStaff] = await Promise.all([
      getLeadCounts(),

      prisma.lead.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 6,
        select: {
          id: true,
          name: true,
          phone: true,
          service: true,
          status: true,
          emailSent: true,
          createdAt: true,
        },
      }),

      prisma.adminUser.count({
        where: {
          isActive: true,
        },
      }),
    ]);

    return res.status(200).json({
      leads: counts,
      latestLeads,
      content: {
        activeStaff,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// список заявок

router.get('/leads', async (req, res, next) => {
  try {
    const parsed = leadsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Некорректные параметры поиска',
      });
    }

    const { status, search, dateFrom, dateTo, page, limit } = parsed.data;

    const where = buildLeadWhere({
      status,
      search,
      dateFrom,
      dateTo,
    });

    const skip = (page - 1) * limit;

    const [items, total, counts] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),

      prisma.lead.count({
        where,
      }),

      getLeadCounts(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      items,
      counts,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// отдельная заявка

router.get('/leads/:id', async (req, res, next) => {
  try {
    const parsed = leadIdSchema.safeParse(req.params.id);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Некорректный ID заявки',
      });
    }

    const lead = await prisma.lead.findUnique({
      where: {
        id: parsed.data,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!lead) {
      return res.status(404).json({
        message: 'Заявка не найдена',
      });
    }

    return res.status(200).json({
      lead,
    });
  } catch (error) {
    return next(error);
  }
});

// изменение заявки

router.patch(
  '/leads/:id',
  validateOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      const parsedId = leadIdSchema.safeParse(req.params.id);

      if (!parsedId.success) {
        return res.status(400).json({
          message: 'Некорректный ID заявки',
        });
      }

      const parsedBody = updateLeadSchema.safeParse(req.body);

      if (!parsedBody.success) {
        return res.status(400).json({
          message: 'Некорректные данные заявки',
        });
      }

      const changes = {
        ...parsedBody.data,
      };

      if (
        req.auth.user.role !== 'OWNER' &&
        changes.assignedToId !== undefined
      ) {
        return res.status(403).json({
          message: 'Назначать сотрудников может только владелец',
        });
      }

      const existingLead = await prisma.lead.findUnique({
        where: {
          id: parsedId.data,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          service: true,
          message: true,
          source: true,
          internalComment: true,
        },
      });

      if (!existingLead) {
        return res.status(404).json({
          message: 'Заявка не найдена',
        });
      }

      if (changes.internalComment !== undefined) {
        changes.internalComment = changes.internalComment || null;

        changes.searchText = buildLeadSearchText({
          name: existingLead.name,
          phone: existingLead.phone,
          service: existingLead.service,
          message: existingLead.message,
          source: existingLead.source,
          internalComment: changes.internalComment,
        });
      }

      if (changes.assignedToId !== undefined && changes.assignedToId !== null) {
        const employee = await prisma.adminUser.findFirst({
          where: {
            id: changes.assignedToId,
            role: 'STAFF',
            isActive: true,
          },
          select: {
            id: true,
          },
        });

        if (!employee) {
          return res.status(400).json({
            message: 'Сотрудник не найден',
          });
        }
      }
      const lead = await prisma.lead.update({
        where: {
          id: parsedId.data,
        },
        data: changes,
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return res.status(200).json({
        message: 'Заявка обновлена',
        lead,
      });
    } catch (error) {
      return next(error);
    }
  },
);

// удаление заявки

router.delete(
  '/leads/:id',
  validateOrigin,
  requireCsrf,
  requireRole('OWNER'),
  async (req, res, next) => {
    try {
      const parsed = leadIdSchema.safeParse(req.params.id);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'Некорректный ID заявки',
        });
      }

      const existingLead = await prisma.lead.findUnique({
        where: {
          id: parsed.data,
        },
        select: {
          id: true,
        },
      });

      if (!existingLead) {
        return res.status(404).json({
          message: 'Заявка не найдена',
        });
      }

      await prisma.lead.delete({
        where: {
          id: parsed.data,
        },
      });

      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

// сотрудники

router.get(
  '/staff',
  requireRole('OWNER'),
  async (req, res, next) => {
    try {
      const users =
        await prisma.adminUser.findMany({
          where: {
            role: 'STAFF',
          },

          orderBy: [
            {
              isActive: 'desc',
            },
            {
              createdAt: 'desc',
            },
          ],

          select: staffSelect,
        });

      const staff =
        users.map(createStaffResponse);

      return res.status(200).json({
        staff,

        counts: {
          all: staff.length,

          active: staff.filter(
            (user) => user.isActive,
          ).length,

          blocked: staff.filter(
            (user) => !user.isActive,
          ).length,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

// создание сотрудника

router.post(
  '/staff',
  validateOrigin,
  requireCsrf,
  requireRole('OWNER'),
  async (req, res, next) => {
    try {
      const parsed =
        createStaffSchema.safeParse(
          req.body,
        );

      if (!parsed.success) {
        return res.status(400).json({
          message:
            'Проверьте имя, email и пароль сотрудника',
        });
      }

      const {
        name,
        email,
        password,
      } = parsed.data;

      const existingUser =
        await prisma.adminUser.findUnique({
          where: {
            email,
          },
          select: {
            id: true,
          },
        });

      if (existingUser) {
        return res.status(409).json({
          message:
            'Пользователь с таким email уже существует',
        });
      }

      const passwordHash =
        await argon2.hash(
          password,
          ARGON2_OPTIONS,
        );

      const createdStaff =
        await prisma.adminUser.create({
          data: {
            name,
            email,
            passwordHash,

            role: 'STAFF',
            isActive: true,
          },

          select: staffSelect,
        });

      return res.status(201).json({
        message: 'Сотрудник создан',

        staff:
          createStaffResponse(
            createdStaff,
          ),
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          message:
            'Пользователь с таким email уже существует',
        });
      }

      return next(error);
    }
  },
);

// изменение сотрудника

router.patch(
  '/staff/:id',
  validateOrigin,
  requireCsrf,
  requireRole('OWNER'),
  async (req, res, next) => {
    try {
      const parsedId =
        staffIdSchema.safeParse(
          req.params.id,
        );

      if (!parsedId.success) {
        return res.status(400).json({
          message:
            'Некорректный ID сотрудника',
        });
      }

      const parsedBody =
        updateStaffSchema.safeParse(
          req.body,
        );

      if (!parsedBody.success) {
        return res.status(400).json({
          message:
            'Проверьте данные сотрудника',
        });
      }

      const staffId = parsedId.data;

      const existingStaff =
        await prisma.adminUser.findFirst({
          where: {
            id: staffId,
            role: 'STAFF',
          },
          select: {
            id: true,
            email: true,
            isActive: true,
          },
        });

      if (!existingStaff) {
        return res.status(404).json({
          message:
            'Сотрудник не найден',
        });
      }

      const {
        name,
        email,
        password,
        isActive,
      } = parsedBody.data;

      const changes = {};

      if (name !== undefined) {
        changes.name = name;
      }

      if (email !== undefined) {
        changes.email = email;
      }

      if (isActive !== undefined) {
        changes.isActive = isActive;
      }

      if (password !== undefined) {
        changes.passwordHash =
          await argon2.hash(
            password,
            ARGON2_OPTIONS,
          );
      }

      const updatedStaff =
        await prisma.$transaction(
          async (tx) => {
            const staff =
              await tx.adminUser.update({
                where: {
                  id: staffId,
                },

                data: changes,
                select: staffSelect,
              });

            // сбрасываем вход при блокировке
            // или смене пароля

            if (
              isActive === false ||
              password !== undefined
            ) {
              await tx.adminSession.deleteMany({
                where: {
                  userId: staffId,
                },
              });
            }

            return staff;
          },
        );

      return res.status(200).json({
        message:
          'Данные сотрудника обновлены',

        staff:
          createStaffResponse(
            updatedStaff,
          ),
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          message:
            'Пользователь с таким email уже существует',
        });
      }

      return next(error);
    }
  },
);

// удаление сотрудника

router.delete(
  '/staff/:id',
  validateOrigin,
  requireCsrf,
  requireRole('OWNER'),
  async (req, res, next) => {
    try {
      const parsed =
        staffIdSchema.safeParse(
          req.params.id,
        );

      if (!parsed.success) {
        return res.status(400).json({
          message:
            'Некорректный ID сотрудника',
        });
      }

      const staff =
        await prisma.adminUser.findFirst({
          where: {
            id: parsed.data,
            role: 'STAFF',
          },
          select: {
            id: true,
          },
        });

      if (!staff) {
        return res.status(404).json({
          message:
            'Сотрудник не найден',
        });
      }

      await prisma.adminUser.delete({
        where: {
          id: staff.id,
        },
      });

      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
