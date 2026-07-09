import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedDefaultPoints } from '@/lib/seed'

/**
 * GET /api/stations
 *   ?brand=Лукойл           — фильтр по бренду (case-insensitive, частичный match)
 *   ?status=Да              — фильтр по статусу
 *   ?includeHidden=false    — показывать ли скрытые (по умолчанию нет)
 *   ?latest=1               — для каждой станции вернуть только последний снапшот
 *
 * Возвращает массив станций с последним снапшотом.
 */
export async function GET(req: NextRequest) {
  await seedDefaultPoints()

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

  // достаём последний снапшот для каждой станции
  const snapshots = await db.fuelSnapshot.findMany({
    where: { stationId: { in: stations.map((s) => s.id) } },
    orderBy: { fetchedAt: 'desc' },
  })
  const latestByStation = new Map<string, (typeof snapshots)[number]>()
  for (const sn of snapshots) {
    if (!latestByStation.has(sn.stationId)) latestByStation.set(sn.stationId, sn)
  }

  const result = stations.map((s) => {
    const latest = latestByStation.get(s.id)
    return {
      id: s.id,
      externalId: s.externalId,
      graphId: s.graphId,
      brand: s.brand,
      address: s.address,
      status: s.status,
      hidden: s.hidden,
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
    }
  })

  return NextResponse.json({ stations: result, total: result.length })
}
