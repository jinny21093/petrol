import { NextResponse } from 'next/server'
import { refreshAllStations } from '@/lib/geoportal'

/**
 * POST /api/refresh
 * Запускает синхронный цикл опроса всех coverage-точек.
 * Возвращает отчёт.
 *
 * Для масштабирования можно вынести в очередь (BullMQ) — но пока in-process.
 */
export async function POST() {
  try {
    const result = await refreshAllStations()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
