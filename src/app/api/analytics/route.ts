import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/analytics?hours=24
 *
 * Общая аналитика по всем АЗС во времени:
 *   - Суммарные остатки по каждому типу топлива в каждый момент опроса
 *   - Количество работающих АЗС на каждый момент
 *
 * Структура ответа:
 * {
 *   fuelTypes: ["92", "95", "ДТ"],
 *   points: [
 *     {
 *       fetchedAt: "ISO",
 *       totalsByFuel: { "92": 25000, "95": 88000 },
 *       activeStations: 9,
 *       totalStations: 12
 *     }
 *   ],
 *   brandBreakdown: [{ brand: "Лукойл", count: 5 }, ...],
 *   totalStations: 12,
 *   totalSnapshots: 248
 * }
 *
 * Группировка: по часам (если hours > 24) или по 10-минутным интервалам (если hours ≤ 24).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const hours = Math.min(Math.max(parseInt(searchParams.get('hours') || '24', 10), 1), 720)

  const since = new Date(Date.now() - hours * 3600 * 1000)

  // Тянем все снапшоты за период, вместе со станцией (для бренда)
  const snapshots = await db.fuelSnapshot.findMany({
    where: { fetchedAt: { gte: since } },
    include: {
      station: {
        select: { id: true, brand: true, status: true, externalId: true },
      },
    },
    orderBy: { fetchedAt: 'asc' },
    take: 10000,
  })

  // Группируем снапшоты по 10-минутным корзинам (или часовым для больших периодов)
  const bucketMs = hours > 24 ? 3600 * 1000 : 10 * 60 * 1000
  const buckets = new Map<number, {
    time: Date
    totalsByFuel: Map<string, number>
    activeStations: Set<string>
    allStations: Set<string>
  }>()

  for (const sn of snapshots) {
    const bucketTime = Math.floor(sn.fetchedAt.getTime() / bucketMs) * bucketMs
    let bucket = buckets.get(bucketTime)
    if (!bucket) {
      bucket = {
        time: new Date(bucketTime),
        totalsByFuel: new Map(),
        activeStations: new Set(),
        allStations: new Set(),
      }
      buckets.set(bucketTime, bucket)
    }

    bucket.allStations.add(sn.stationId)
    if (sn.station.status === 'Да') {
      bucket.activeStations.add(sn.stationId)
    }

    let parsed: { fuels?: { fuel: string; liters: number | null }[] }
    try {
      parsed = JSON.parse(sn.parsedFuels)
    } catch {
      parsed = { fuels: [] }
    }
    for (const f of parsed.fuels || []) {
      if (typeof f.liters === 'number') {
        bucket.totalsByFuel.set(f.fuel, (bucket.totalsByFuel.get(f.fuel) || 0) + f.liters)
      }
    }
  }

  // Собираем все типы топлива
  const fuelTypeSet = new Set<string>()
  for (const b of buckets.values()) {
    for (const k of b.totalsByFuel.keys()) fuelTypeSet.add(k)
  }
  const fuelTypes = Array.from(fuelTypeSet).sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    if (!isNaN(na)) return -1
    if (!isNaN(nb)) return 1
    return a.localeCompare(b)
  })

  // Сортируем корзины по времени
  const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.time.getTime() - b.time.getTime())

  const points = sortedBuckets.map((b) => {
    const totalsByFuel: Record<string, number> = {}
    for (const ft of fuelTypes) {
      totalsByFuel[ft] = b.totalsByFuel.get(ft) || 0
    }
    return {
      fetchedAt: b.time.toISOString(),
      totalsByFuel,
      activeStations: b.activeStations.size,
      totalStations: b.allStations.size,
    }
  })

  // Разбивка по брендам — на основе всех известных станций
  const allStations = await db.station.findMany({
    select: { brand: true, status: true },
  })
  const brandMap = new Map<string, number>()
  for (const s of allStations) {
    const b = s.brand || 'Без бренда'
    brandMap.set(b, (brandMap.get(b) || 0) + 1)
  }
  const brandBreakdown = Array.from(brandMap.entries())
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    fuelTypes,
    points,
    brandBreakdown,
    totalStations: allStations.length,
    totalActiveStations: allStations.filter((s) => s.status === 'Да').length,
    totalSnapshots: snapshots.length,
    hoursRequested: hours,
    bucketSize: bucketMs === 3600 * 1000 ? '1h' : '10min',
  })
}
