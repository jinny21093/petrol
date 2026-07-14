import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/stats — агрегированная статистика по дашборду.
 * Включает статус источника данных (alive/expired) для баннера.
 */
export async function GET() {
  const [
    totalStations,
    activeStations,
    hiddenStations,
    totalSnapshots,
    lastRefreshAtSetting,
    sourceStatusSetting,
    sourceStatusAtSetting,
  ] = await Promise.all([
    db.station.count(),
    db.station.count({ where: { status: 'Да' } }),
    db.station.count({ where: { hidden: true } }),
    db.fuelSnapshot.count(),
    db.setting.findUnique({ where: { id: 'lastRefreshAt' } }),
    db.setting.findUnique({ where: { id: 'sourceStatus' } }),
    db.setting.findUnique({ where: { id: 'sourceStatusAt' } }),
  ])

  const brands = await db.station.groupBy({
    by: ['brand'],
    _count: { _all: true },
    orderBy: { _count: { brand: 'desc' } },
  })

  return NextResponse.json({
    totalStations,
    activeStations,
    hiddenStations,
    totalSnapshots,
    lastRefreshAt: lastRefreshAtSetting?.value || null,
    sourceStatus: sourceStatusSetting?.value || 'unknown',
    sourceStatusAt: sourceStatusAtSetting?.value || null,
    brands: brands.map((b) => ({ brand: b.brand, count: b._count._all })),
  })
}
