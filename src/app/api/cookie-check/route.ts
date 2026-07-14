import { NextResponse } from 'next/server'
import { checkSourceStatus } from '@/lib/geoportal'
import { db } from '@/lib/db'

/**
 * GET /api/cookie-check
 *
 * Лёгкий heartbeat-запрос: проверяет доступность platforma35.ru без
 * полного опроса АЗС. Делает один GET к /api/markers/ и смотрит,
 * вернулся ли непустой массив.
 *
 * Возвращает:
 * {
 *   status: 'alive' | 'expired' | 'unknown',
 *   checkedAt: "ISO"
 * }
 *
 * Cron вызывает этот endpoint каждые 5 минут — это:
 *   1) обновляет sourceStatus в БД (для отображения в дашборде)
 *   2) не нагружает platforma35 лишними запросами (один GET вместо полного refresh)
 *
 * Историческое название route 'cookie-check' сохранено для совместимости
 * с cron-скриптами. Раньше здесь проверялась JSESSIONID для геопортала.
 */
export async function GET() {
  const status = await checkSourceStatus()

  const checkedAtSetting = await db.setting.findUnique({ where: { id: 'sourceStatusAt' } })

  return NextResponse.json({
    status,
    checkedAt: checkedAtSetting?.value || new Date().toISOString(),
  })
}
