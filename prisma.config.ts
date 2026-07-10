/**
 * Конфигурация Prisma CLI для v7.
 *
 * В v7 настройки окружения вынесены из schema.prisma в этот файл.
 * DATABASE_URL читается из .env через process.env (Next.js автоматически
 * загружает .env, для bun-скриптов тоже работает).
 *
 * Direct TCP через @prisma/adapter-better-sqlite3 — рекомендуется для v7
 * вместо использования URL в схеме. Адаптер подключается в src/lib/db.ts.
 */
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
