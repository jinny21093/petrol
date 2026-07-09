/**
 * Клиент геопортала Вологды (https://3d-geoportal.vologda-city.ru/portal/gasstation)
 *
 * Эндпоинты:
 *  - POST /api/banks/1/graphic/layers/sel  — список АЗС в области
 *  - POST /api/banks/1/graphic/layers/find — геометрия (опционально, не используется)
 *
 * Авторизация: анонимная сессия через JSESSIONID. Если кука не задана в настройках,
 * клиент сам делает GET к /portal/gasstation и забирает Set-Cookie.
 */

import { db } from '@/lib/db'

const BASE_URL = 'https://3d-geoportal.vologda-city.ru'
const SEL_PATH = '/api/banks/1/graphic/layers/sel'
const PAGE_PATH = '/portal/gasstation'

const LAYER_ID = 323
const FACT_DSCR_ID = 372

const LAYER_SETTINGS = JSON.stringify({
  clssSettings: { currentIndex: 0, isRangeManually: false },
  zeroBoundScale: '200000',
  customStroke: { strokes: [] },
  coordType: 2,
  advCoordType: {
    type: 'com.geocad.wc.graphicmodel.renderer.paintsettings.container.FontSymbolContainer',
    properties: {
      useLayerColor: true,
      type: 1,
      code: 'a',
      font: { name: 'GEE-Symbols', style: 0, size: 10, pointSize: 10, fontSerializedDataVersion: 1 },
      source: 0,
      symbolParam: { size: '0', distance: 'null', width: '0', indent: '0', orient: 0, color: 0 },
      symbolContainerList: [],
    },
  },
  coordSize: '5',
  coordColor: -16426748,
  scriptSettings: {},
  referenceSettings: {},
  imageSettings: {},
  textSettings: {
    textFont: { fontSerializedDataVersion: 1, name: 'Serif', pointSize: 10, size: 10, style: 0 },
  },
  xyz: false,
  rum: false,
  dir: false,
  zon: false,
  squ: false,
  bor: false,
  hid: false,
  act: true,
  inLegend: true,
  isEdges3d: false,
  clustered: {
    enable: false,
    vectorType: false,
    distance: 20,
    isSymbol: false,
    colorSymbol: '#7a7a7a',
    colorStroke: '#050000',
    colorText: '#ff0000',
    borderColor: '#7971A0',
    pointRadius: 8,
    widthStroke: 3,
    font: 'sans-serif',
    fontSize: 10,
    groupSize: 20,
    textHAligment: 1,
    textAligment: 1,
    zoomMin: 0,
    zoomMax: 27,
  },
  crsOfNewObjects: null,
  catalogCrs: null,
})

export interface GeoportalStation {
  id: number
  graphId: number | null
  brand: string
  address: string
  status: string
  rawDetails: string
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
}

interface SettingBag {
  jsessionId?: string
}

async function loadSettings(): Promise<SettingBag> {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.id] = r.value
  return { jsessionId: map['jsessionId'] || undefined }
}

async function saveSetting(id: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { id },
    create: { id, value },
    update: { value },
  })
}

function buildHeaders(cookie?: string): HeadersInit {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: BASE_URL,
    Referer: `${BASE_URL}${PAGE_PATH}`,
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

/**
 * Получить свежую JSESSIONID, открыв страницу gasstation.
 * Возвращает строку вида "JSESSIONID=XXXXXXXX".
 */
async function fetchFreshSession(): Promise<string | null> {
  try {
    const resp = await fetch(`${BASE_URL}${PAGE_PATH}`, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
    })
    const setCookie = resp.headers.get('set-cookie')
    if (setCookie) {
      const match = setCookie.match(/JSESSIONID=[^;]+/)
      if (match) return match[0]
    }
    return null
  } catch {
    return null
  }
}

async function getCookie(): Promise<string | null> {
  const settings = await loadSettings()
  if (settings.jsessionId) return `JSESSIONID=${settings.jsessionId}`
  // попытка достать свежую куку
  const fresh = await fetchFreshSession()
  if (fresh) {
    const m = fresh.match(/JSESSIONID=([^;]+)/)
    if (m) await saveSetting('jsessionId', m[1])
    return fresh
  }
  return null
}

/**
 * Парсит текст деталей топлива (поле 6920) в структурированный массив.
 * Пример текста:
 *   Остаток топлива на 10:00:\n92 -  5000 л / 250 машин\n95 - 17700 л / 885 машин
 *   Ожидается подвоз в 10:30\n95 - 11100 л / 555 машин\n92 - 6100 л / 305 машин
 */
export function parseFuelDetails(raw: string): {
  comment: string | null
  fuels: { fuel: string; liters: number | null; cars: number | null }[]
} {
  if (!raw) return { comment: null, fuels: [] }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const fuels: { fuel: string; liters: number | null; cars: number | null }[] = []
  const commentLines: string[] = []
  const fuelRe = /^(\d{2,3})\s*[-–—]\s*(\d+(?:\.\d+)?)?\s*л?\s*(?:\/\s*(\d+(?:\.\d+)?)?\s*машин)?/i

  for (const line of lines) {
    const m = line.match(fuelRe)
    if (m) {
      fuels.push({
        fuel: m[1],
        liters: m[2] ? parseFloat(m[2]) : null,
        cars: m[3] ? parseFloat(m[3]) : null,
      })
    } else {
      commentLines.push(line)
    }
  }
  return {
    comment: commentLines.length ? commentLines.join(' | ') : null,
    fuels,
  }
}

interface SelRecord {
  id: number
  graphId?: number | null
  paints?: unknown
  data?: Record<string, unknown>
}

interface SelResponse {
  total?: number
  records?: SelRecord[]
}

/**
 * Опрашивает одну coverage-точку и возвращает список АЗС в её области.
 */
async function fetchStationsAtPoint(
  mapX: number,
  mapY: number,
  scale: number,
  cookie: string,
): Promise<GeoportalStation[]> {
  const url = new URL(`${BASE_URL}${SEL_PATH}`)
  url.searchParams.set('mapX', String(mapX))
  url.searchParams.set('mapY', String(mapY))
  url.searchParams.set('scale', String(scale))
  url.searchParams.set('groupingDistance', '0')
  url.searchParams.set('isAsPoint', 'false')

  // фильтр по статусу "Да" НЕ накладываем — хотим видеть все АЗС, включая неработающие
  const body = {
    layerId: LAYER_ID,
    layerSettings: LAYER_SETTINGS,
    filter: null,
  }

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: buildHeaders(cookie),
    body: JSON.stringify(body),
  })

  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`Сессия истекла (HTTP ${resp.status}). Обновите JSESSIONID.`)
  }
  if (!resp.ok) {
    throw new Error(`Геопортал вернул HTTP ${resp.status}`)
  }

  const json = (await resp.json()) as SelResponse
  const records = json.records || []

  return records.map((rec) => {
    const d = rec.data || {}
    const brand = String(d['6917'] ?? '')
    const address = String(d['6918'] ?? '')
    const status = String(d['6919'] ?? '')
    const rawDetails = String(d['6920'] ?? '')
    const created = d['6917'] ? parseEpochField(d['6921']) : null
    const updated = parseEpochField(d['6922'])
    return {
      id: rec.id,
      graphId: rec.graphId ?? null,
      brand,
      address,
      status,
      rawDetails,
      sourceCreatedAt: created,
      sourceUpdatedAt: updated,
    }
  })
}

function parseEpochField(v: unknown): Date | null {
  if (!v || typeof v !== 'object') return null
  const obj = v as { epochSecond?: number; nano?: number }
  if (typeof obj.epochSecond !== 'number') return null
  return new Date(obj.epochSecond * 1000)
}

export interface RefreshResult {
  pointsProcessed: number
  stationsFound: number
  stationsNew: number
  stationsUpdated: number
  errors: string[]
  startedAt: Date
  finishedAt: Date
}

/**
 * Главный цикл опроса. Проходит по всем активным coverage-точкам,
 * обновляет/создаёт станции, сохраняет свежий снапшот остатков для каждой.
 */
export async function refreshAllStations(): Promise<RefreshResult> {
  const startedAt = new Date()
  const errors: string[] = []
  let stationsFound = 0
  let stationsNew = 0
  let stationsUpdated = 0

  const cookie = await getCookie()
  if (!cookie) {
    errors.push('Не удалось получить JSESSIONID — задайте её в настройках.')
    return {
      pointsProcessed: 0,
      stationsFound: 0,
      stationsNew: 0,
      stationsUpdated: 0,
      errors,
      startedAt,
      finishedAt: new Date(),
    }
  }

  const points = await db.coveragePoint.findMany({ where: { enabled: true } })
  for (const p of points) {
    try {
      const found = await fetchStationsAtPoint(p.mapX, p.mapY, p.scale, cookie)
      stationsFound += found.length
      for (const s of found) {
        // upsert по externalId
        const existing = await db.station.findUnique({
          where: { externalId: s.id },
        })
        const data = {
          brand: s.brand || existing?.brand || 'Неизвестно',
          address: s.address || existing?.address || '',
          status: s.status || existing?.status || 'Нет',
          graphId: s.graphId ?? existing?.graphId ?? null,
        }
        let station: { id: string }
        if (existing) {
          const updated = await db.station.update({
            where: { externalId: s.id },
            data,
          })
          station = updated
          // считаем "обновлённой", если изменилось что-то существенное
          if (
            existing.brand !== data.brand ||
            existing.address !== data.address ||
            existing.status !== data.status
          ) {
            stationsUpdated++
          }
        } else {
          station = await db.station.create({
            data: { externalId: s.id, ...data },
          })
          stationsNew++
        }

        // сохраняем снапшот
        const parsed = parseFuelDetails(s.rawDetails)
        await db.fuelSnapshot.create({
          data: {
            stationId: station.id,
            rawDetails: s.rawDetails,
            parsedFuels: JSON.stringify(parsed),
            sourceCreatedAt: s.sourceCreatedAt,
            sourceUpdatedAt: s.sourceUpdatedAt,
          },
        })
      }
    } catch (e) {
      errors.push(`Точка "${p.name}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await saveSetting('lastRefreshAt', new Date().toISOString())
  await saveSetting(
    'lastRefreshSummary',
    JSON.stringify({ stationsFound, stationsNew, stationsUpdated, errorsCount: errors.length }),
  )

  return {
    pointsProcessed: points.length,
    stationsFound,
    stationsNew,
    stationsUpdated,
    errors,
    startedAt,
    finishedAt: new Date(),
  }
}

export const GEOPORTAL_CONSTANTS = {
  LAYER_ID,
  FACT_DSCR_ID,
  BASE_URL,
  PAGE_PATH,
}
