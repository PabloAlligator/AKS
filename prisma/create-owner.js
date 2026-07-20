import 'dotenv/config';
import argon2 from 'argon2';

import prisma from '../lib/prisma.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();

  if (!value) {
    throw new Error(`Не заполнена переменная окружения ${name}`);
  }

  return value;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function createOwner() {
  const name = getRequiredEnv('OWNER_NAME');
  const email = normalizeEmail(getRequiredEnv('OWNER_EMAIL'));
  const password = getRequiredEnv('OWNER_PASSWORD');

  if (name.length < 2 || name.length > 80) {
    throw new Error('OWNER_NAME должен содержать от 2 до 80 символов');
  }

  if (!validateEmail(email) || email.length > 254) {
    throw new Error('OWNER_EMAIL содержит некорректный email');
  }

  if (password.length < 12 || password.length > 128) {
    throw new Error('OWNER_PASSWORD должен содержать от 12 до 128 символов');
  }

  const existingOwner = await prisma.adminUser.findFirst({
    where: {
      role: 'OWNER',
    },
    select: {
      id: true,
      email: true,
    },
  });

  if (existingOwner && existingOwner.email !== email) {
    throw new Error(
      `В системе уже существует OWNER с email ${existingOwner.email}`,
    );
  }

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

  const owner = await prisma.adminUser.upsert({
    where: {
      email,
    },
    update: {
      name,
      passwordHash,
      role: 'OWNER',
      isActive: true,
    },
    create: {
      name,
      email,
      passwordHash,
      role: 'OWNER',
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  console.log('');
  console.log('Владелец админ-панели создан или обновлён:');
  console.log(`ID: ${owner.id}`);
  console.log(`Имя: ${owner.name}`);
  console.log(`Email: ${owner.email}`);
  console.log(`Роль: ${owner.role}`);
  console.log(`Активен: ${owner.isActive ? 'да' : 'нет'}`);
}

createOwner()
  .catch((error) => {
    console.error('');
    console.error('Не удалось создать владельца:');
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
