/**
 * Prisma Client singleton для Prisma v7.
 *
 * Главное изменение в v7: PrismaClient импортируется из сгенерированной
 * папки (./generated/prisma/client.js), а не из @prisma/client.
 * БД подключается через adapter (@prisma/adapter-better-sqlite3) — это
 * Direct TCP, рекомендуемый способ в v7.
 */
import { PrismaClient } from '../../prisma/generated/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL,
  })
  return new PrismaClient({
    adapter,
    // log: ['query'],  // раскомментировать для отладки SQL
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
