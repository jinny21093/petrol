import { NextResponse } from 'next/server'
import { checkCookieStatus } from '@/lib/geoportal'
import { db } from '@/lib/db'

/**
 * GET /api/cookie-check
 *
 * Лёгкий heartbeat-запрос: проверяет статус JSESSIONID без полного опроса АЗС.
 * Делает один GET к геопорталу /api/info и смотрит, есть ли в ответе SupportESIA.
 *
 * Возвращает:
 * {
 *   status: 'alive' | 'expired' | 'not_set' | 'unknown',
 *   checkedAt: "ISO",
 *   jsessionIdMasked: "C751...5EEC" or null
 * }
 *
 * Cron вызывает этот endpoint каждые 5 минут — это:
 *   1) обновляет cookieStatus в БД (для отображения в дашборде)
 *   2) возможно, продлевает сессию (если геопортал продлевает JSESSIONID от активности)
 */
export async function GET() {
  const status = await checkCookieStatus()

  // Достаём маскированную куку для отображения
  const setting = await db.setting.findUnique({ where: { id: 'jsessionId' } })
  const jsessionIdMasked = setting?.value
    ? `${setting.value.slice(0, 4)}...${setting.value.slice(-4)}`
    : null

  // Достаём время последней проверки
  const checkedAtSetting = await db.setting.findUnique({ where: { id: 'cookieStatusAt' } })

  return NextResponse.json({
    status,
    checkedAt: checkedAtSetting?.value || new Date().toISOString(),
    jsessionIdMasked,
  })
}
