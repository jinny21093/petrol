import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/stations
 *   ?brand=Лукойл           — фильтр по бренду (case-insensitive, частичный match)
 *   ?status=Да              — фильтр по статусу
 *   ?includeHidden=false    — показывать ли скрытые (по умолчанию нет)
 *
 * Возвращает массив станций с последним и предыдущим снапшотом (для трендов).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand')?.trim()
  const status = searchParams.get('status')?.trim()
  const includeHidden = searchParams.get('includeHidden') === 'true'

  const where: {
    hidden?: boolean
    brand?: { contains: string }
    status?: { equals: string }
  } = {}
  if (!includeHidden) where.hidden = false
  if (brand) where.brand = { contains: brand }
  if (status) where.status = { equals: status }

  const stations = await db.station.findMany({
    where,
    orderBy: [{ brand: 'asc' }, { address: 'asc' }],
    take: 500,
  })

  // достаём последние 2 снапшота для каждой станции (для трендов)
  // Сортируем по sourceUpdatedAt (время источника) — это настоящая хронология.
  // fetchedAt (когда мы сохранили) не подходит, потому что importHistoryFromPlatforma35
  // создаёт много старых точек одновременно с одинаковым fetchedAt.
  const snapshots = await db.fuelSnapshot.findMany({
    where: { stationId: { in: stations.map((s) => s.id) } },
    orderBy: [{ sourceUpdatedAt: 'desc' }, { fetchedAt: 'desc' }],
  })
  const latestByStation = new Map<string, (typeof snapshots)[number]>()
  const previousByStation = new Map<string, (typeof snapshots)[number]>()
  for (const sn of snapshots) {
    if (!latestByStation.has(sn.stationId)) {
      latestByStation.set(sn.stationId, sn)
    } else if (!previousByStation.has(sn.stationId)) {
      previousByStation.set(sn.stationId, sn)
    }
  }

  const result = stations.map((s) => {
    const latest = latestByStation.get(s.id)
    const previous = previousByStation.get(s.id)
    return {
      id: s.id,
      externalId: s.externalId,
      brand: s.brand,
      address: s.address,
      status: s.status,
      hidden: s.hidden,
      source: s.source,
      longitude: s.longitude,
      latitude: s.latitude,
      logoUrl: s.logoUrl,
      availabilityFuel: s.availabilityFuel,
      fuelDelivery: s.fuelDelivery,
      updatedAt: s.updatedAt,
      latestSnapshot: latest
        ? {
            id: latest.id,
            rawDetails: latest.rawDetails,
            parsedFuels: JSON.parse(latest.parsedFuels),
            sourceCreatedAt: latest.sourceCreatedAt,
            sourceUpdatedAt: latest.sourceUpdatedAt,
            fetchedAt: latest.fetchedAt,
          }
        : null,
      previousSnapshot: previous
        ? {
            id: previous.id,
            parsedFuels: JSON.parse(previous.parsedFuels),
            sourceUpdatedAt: previous.sourceUpdatedAt,
            fetchedAt: previous.fetchedAt,
          }
        : null,
    }
  })

  return NextResponse.json({ stations: result, total: result.length })
}
