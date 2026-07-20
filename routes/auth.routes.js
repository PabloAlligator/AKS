import { randomBytes } from 'node:crypto';

import express from 'express';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import prisma from '../lib/prisma.js';

import requireAuth from '../middleware/require-auth.js';
import requireCsrf from '../middleware/require-csrf.js';
import validateOrigin from '../middleware/validate-origin.js';

import {
  createAdminSession,
  deleteAdminSession,
  rotateCsrfToken,
} from '../services/session.service.js';

import {
  SESSION_COOKIE_NAME,
  getSessionCookieOptions,
  getSessionCookieClearOptions,
} from '../config/security.js';

const router = express.Router();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(254),

    password: z
      .string()
      .min(1)
      .max(128),
  })
  .strict();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    message: 'Слишком много попыток входа. Повторите позже.',
  },
});

const dummyPasswordHashPromise = argon2.hash(
  randomBytes(32).toString('hex'),
  ARGON2_OPTIONS,
);

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  next();
});

// вход

router.post(
  '/login',
  loginLimiter,
  validateOrigin,
  async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          message: 'Проверьте email и пароль',
        });
      }

      const { email, password } = parsed.data;

      const user = await prisma.adminUser.findUnique({
        where: {
          email,
        },
        select: {
          id: true,
          name: true,
          email: true,
          passwordHash: true,
          role: true,
          isActive: true,
        },
      });

      const passwordHash = user
        ? user.passwordHash
        : await dummyPasswordHashPromise;

      const passwordMatches = await argon2
        .verify(passwordHash, password)
        .catch(() => false);

      if (
        !user ||
        !passwordMatches ||
        !user.isActive
      ) {
        return res.status(401).json({
          message: 'Неверный email или пароль',
        });
      }

      const {
        sessionToken,
      } = await createAdminSession({
        userId: user.id,
        req,
      });

      await prisma.adminUser.update({
        where: {
          id: user.id,
        },
        data: {
          lastLoginAt: new Date(),
        },
      });

      res.cookie(
        SESSION_COOKIE_NAME,
        sessionToken,
        getSessionCookieOptions(),
      );

      return res.status(200).json({
        message: 'Вход выполнен',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

// текущий пользователь

router.get(
  '/me',
  requireAuth,
  (req, res) => {
    return res.status(200).json({
      user: req.auth.user,
      session: {
        expiresAt: req.auth.session.expiresAt,
      },
    });
  },
);

// csrf-токен

router.get(
  '/csrf',
  requireAuth,
  async (req, res, next) => {
    try {
      const csrfToken = await rotateCsrfToken(
        req.auth.session.id,
      );

      return res.status(200).json({
        csrfToken,
      });
    } catch (error) {
      return next(error);
    }
  },
);

// выход

router.post(
  '/logout',
  validateOrigin,
  requireAuth,
  requireCsrf,
  async (req, res, next) => {
    try {
      await deleteAdminSession(
        req.auth.session.id,
      );

      res.clearCookie(
        SESSION_COOKIE_NAME,
        getSessionCookieClearOptions(),
      );

      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
