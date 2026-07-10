import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedDefaultPoints } from '@/lib/seed'

/**
 * GET /api/stats — агрегированная статистика по дашборду.
 * Включает статус куки (alive/expired/not_set) для баннера.
 */
export async function GET() {
  await seedDefaultPoints()
  const [
    totalStations,
    activeStations,
    hiddenStations,
    totalPoints,
    enabledPoints,
    totalSnapshots,
    lastRefreshAtSetting,
    cookieStatusSetting,
    cookieStatusAtSetting,
  ] = await Promise.all([
    db.station.count(),
    db.station.count({ where: { status: 'Да' } }),
    db.station.count({ where: { hidden: true } }),
    db.coveragePoint.count(),
    db.coveragePoint.count({ where: { enabled: true } }),
    db.fuelSnapshot.count(),
    db.setting.findUnique({ where: { id: 'lastRefreshAt' } }),
    db.setting.findUnique({ where: { id: 'cookieStatus' } }),
    db.setting.findUnique({ where: { id: 'cookieStatusAt' } }),
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
    totalPoints,
    enabledPoints,
    totalSnapshots,
    lastRefreshAt: lastRefreshAtSetting?.value || null,
    cookieStatus: cookieStatusSetting?.value || 'unknown',
    cookieStatusAt: cookieStatusAtSetting?.value || null,
    brands: brands.map((b) => ({ brand: b.brand, count: b._count._all })),
  })
}
