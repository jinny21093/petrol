/**
 * Конфигурация Prisma CLI для v7.
 *
 * В v7 настройки окружения вынесены из schema.prisma в этот файл.
 * DATABASE_URL читается из .env через dotenv (явно, т.к. Prisma CLI
 * в v7 не загружает .env автоматически — в отличие от v6).
 *
 * Direct TCP через @prisma/adapter-better-sqlite3 — рекомендуется для v7
 * вместо использования URL в схеме. Адаптер подключается в src/lib/db.ts.
 */
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
