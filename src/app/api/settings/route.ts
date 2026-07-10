import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const KNOWN_KEYS = ['jsessionId', 'lastRefreshAt', 'lastRefreshSummary'] as const

/**
 * GET /api/settings — возвращает все настройки.
 * jsessionId частично маскируется для безопасности отображения.
 */
export async function GET() {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.id] = r.value
  const masked = { ...map }
  if (masked.jsessionId) {
    const v = masked.jsessionId
    masked.jsessionId =
      v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : '****'
  }
  return NextResponse.json({ settings: masked })
}

/**
 * PUT /api/settings
 * Body: { jsessionId?: string }
 * Сохраняет JSESSIONID (или другие настройки из KNOWN_KEYS).
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Ожидается JSON-тело' }, { status: 400 })
  }
  const updates: { id: string; value: string }[] = []
  for (const k of KNOWN_KEYS) {
    const v = (body as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim()) {
      updates.push({ id: k, value: v.trim() })
    }
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: 'Нет известных полей для обновления' }, { status: 400 })
  }
  for (const u of updates) {
    await db.setting.upsert({
      where: { id: u.id },
      create: { id: u.id, value: u.value },
      update: { value: u.value },
    })
  }
  return NextResponse.json({ ok: true, updated: updates.map((u) => u.id) })
}
