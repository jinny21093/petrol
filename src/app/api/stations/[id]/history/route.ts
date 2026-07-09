import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteCtx {
  params: Promise<{ id: string }>
}

/**
 * GET /api/stations/[id]/history?hours=24
 *
 * Возвращает историю остатков топлива по конкретной АЗС за последние N часов
 * (по умолчанию 24). Группирует по типам топлива, готовит данные для графика.
 *
 * Структура ответа:
 * {
 *   station: { id, brand, address, status },
 *   fuelTypes: ["92", "95", "ДТ"],
 *   points: [
 *     { fetchedAt: "ISO", sourceUpdatedAt: "ISO", fuels: { "92": 5000, "95": 17000 } }
 *   ]
 * }
 */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const { searchParams } = new URL(req.url)
  const hours = Math.min(Math.max(parseInt(searchParams.get('hours') || '24', 10), 1), 720) // от 1 часа до 30 дней

  const station = await db.station.findUnique({
    where: { id },
    select: { id: true, brand: true, address: true, status: true },
  })
  if (!station) {
    return NextResponse.json({ error: 'Станция не найдена' }, { status: 404 })
  }

  const since = new Date(Date.now() - hours * 3600 * 1000)
  const snapshots = await db.fuelSnapshot.findMany({
    where: { stationId: id, fetchedAt: { gte: since } },
    orderBy: { fetchedAt: 'asc' },
    take: 2000, // защитный лимит
  })

  // Собираем все типы топлива и точки
  const fuelTypeSet = new Set<string>()
  const points: { fetchedAt: string; sourceUpdatedAt: string | null; fuels: Record<string, number | null> }[] = []

  for (const sn of snapshots) {
    let parsed: { comment?: string | null; fuels?: { fuel: string; liters: number | null; cars: number | null }[] }
    try {
      parsed = JSON.parse(sn.parsedFuels)
    } catch {
      parsed = { fuels: [] }
    }
    const fuelsMap: Record<string, number | null> = {}
    for (const f of parsed.fuels || []) {
      fuelTypeSet.add(f.fuel)
      fuelsMap[f.fuel] = f.liters
    }
    points.push({
      fetchedAt: sn.fetchedAt.toISOString(),
      sourceUpdatedAt: sn.sourceUpdatedAt?.toISOString() || null,
      fuels: fuelsMap,
    })
  }

  // Сортируем типы топлива: числовые по возрастанию, потом строковые (ДТ, газ)
  const fuelTypes = Array.from(fuelTypeSet).sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    return a.localeCompare(b)
  })

  return NextResponse.json({
    station,
    fuelTypes,
    points,
    totalSnapshots: snapshots.length,
    hoursRequested: hours,
  })
}
