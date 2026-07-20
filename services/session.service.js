import { createHash, randomBytes } from 'node:crypto';

import prisma from '../lib/prisma.js';
import { SESSION_TTL_MS } from '../config/security.js';

const TOKEN_BYTES = 32;
const MAX_ACTIVE_SESSIONS = 5;

function generateToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(value) {
  return createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

export function getRequestMetadata(req) {
  return {
    ipAddress: String(req.ip || '').slice(0, 64),
    userAgent: String(req.get('user-agent') || '').slice(0, 512),
  };
}

export async function createAdminSession({ userId, req }) {
  const sessionToken = generateToken();
  const csrfToken = generateToken();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const metadata = getRequestMetadata(req);

  const session = await prisma.$transaction(async (transaction) => {
    await transaction.adminSession.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });

    const overflowSessions = await transaction.adminSession.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip: MAX_ACTIVE_SESSIONS - 1,
      select: {
        id: true,
      },
    });

    if (overflowSessions.length > 0) {
      await transaction.adminSession.deleteMany({
        where: {
          id: {
            in: overflowSessions.map((item) => item.id),
          },
        },
      });
    }

    return transaction.adminSession.create({
      data: {
        userId,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        expiresAt,
        lastUsedAt: now,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  return {
    session,
    sessionToken,
    csrfToken,
  };
}

export async function rotateCsrfToken(sessionId) {
  const csrfToken = generateToken();

  await prisma.adminSession.update({
    where: {
      id: sessionId,
    },
    data: {
      csrfTokenHash: hashToken(csrfToken),
    },
  });

  return csrfToken;
}

export async function deleteAdminSession(sessionId) {
  await prisma.adminSession
    .delete({
      where: {
        id: sessionId,
      },
    })
    .catch(() => undefined);
}
