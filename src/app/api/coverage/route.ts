import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedDefaultPoints } from '@/lib/seed'

/**
 * GET /api/coverage — список всех coverage-точек
 */
export async function GET() {
  await seedDefaultPoints()
  const points = await db.coveragePoint.findMany({
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ points, total: points.length })
}

/**
 * POST /api/coverage
 * Body: { name, mapX, mapY, scale?, enabled? }
 * Создаёт новую coverage-точку.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Ожидается JSON-тело' }, { status: 400 })
  }
  const { name, mapX, mapY, scale, enabled } = body as {
    name?: string
    mapX?: number
    mapY?: number
    scale?: number
    enabled?: boolean
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Поле name обязательно' }, { status: 400 })
  }
  if (typeof mapX !== 'number' || typeof mapY !== 'number') {
    return NextResponse.json({ error: 'Поля mapX и mapY должны быть числами' }, { status: 400 })
  }

  const point = await db.coveragePoint.create({
    data: {
      name: name.trim(),
      mapX,
      mapY,
      scale: typeof scale === 'number' ? scale : 156093.8619923378,
      enabled: typeof enabled === 'boolean' ? enabled : true,
    },
  })
  return NextResponse.json({ point }, { status: 201 })
}
