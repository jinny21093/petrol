import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteCtx {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/coverage/[id]
 * Body: { name?, mapX?, mapY?, scale?, enabled? }
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
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
  const data: {
    name?: string
    mapX?: number
    mapY?: number
    scale?: number
    enabled?: boolean
  } = {}
  if (typeof name === 'string' && name.trim()) data.name = name.trim()
  if (typeof mapX === 'number') data.mapX = mapX
  if (typeof mapY === 'number') data.mapY = mapY
  if (typeof scale === 'number') data.scale = scale
  if (typeof enabled === 'boolean') data.enabled = enabled

  try {
    const updated = await db.coveragePoint.update({ where: { id }, data })
    return NextResponse.json({ point: updated })
  } catch {
    return NextResponse.json({ error: 'Точка не найдена' }, { status: 404 })
  }
}

/**
 * DELETE /api/coverage/[id]
 */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  try {
    await db.coveragePoint.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Точка не найдена' }, { status: 404 })
  }
}
