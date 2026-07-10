/**
 * Клиент источников данных о наличии топлива на АЗС Вологды.
 *
 * ОСНОВНОЙ источник — публичный API platforma35.ru:
 *   GET https://platforma35.ru/communal_economy/azs/api/markers/
 *   - без авторизации
 *   - отдаёт сразу все 9 АЗС города
 *   - уже структурированные данные (тип топлива → литры)
 *   - координаты, логотипы, история за день
 *
 * РЕЗЕРВНЫЙ источник (legacy) — геопортал 3d-geoportal.vologda-city.ru:
 *   - требует JSESSIONID (ESIA-авторизация через Госуслуги)
 *   - кука регулярно протухает
 *   - сырой текст «92 - 5000 л / 250 машин», нужен парсер
 *   - нет координат
 *   Используется только если platforma35 упадёт.
 */

import { db } from '@/lib/db'
import {
  fetchAllStations as fetchAllPlatforma35,
  absoluteLogoUrl,
  parsePlatforma35Time,
  type Platforma35Marker,
} from '@/lib/platforma35'

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
 *
 * Примеры текста с геопортала:
 *   Остаток топлива на 10:00:\n92 -  5000 л / 250 машин\n95 - 17700 л / 885 машин
 *   Ожидается подвоз в 10:30\n95 - 11100 л / 555 машин\n92 - 6100 л / 305 машин
 *   Остаток топлива на 13:00:\nДТ - 1066 машин\n92 - 700 машин\n95 - 400 машин
 *
 * Особенности:
 *  - Тип топлива может быть числовым (92, 95, 98, 100) или строковым (ДТ, ДТ-З, Газ)
 *  - Литры могут отсутствовать (Газпромнефть сообщает только количество машин)
 *  - Машины могут отсутствовать (некоторые Лукойлы — только литры)
 *  - Заголовок "Остаток топлива на ЧЧ:ММ:" — технический, не комментарий
 *  - Реальные комментарии: "Ожидается подвоз в 10:30", "Нет топлива" и т.п.
 */
export function parseFuelDetails(raw: string): {
  comment: string | null
  fuels: { fuel: string; liters: number | null; cars: number | null }[]
} {
  if (!raw) return { comment: null, fuels: [] }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const fuels: { fuel: string; liters: number | null; cars: number | null }[] = []
  const commentLines: string[] = []

  // Тип топлива: 2-3 цифры (92, 95, 100) ИЛИ буквы (ДТ, ДТ-З, Газ, СУГ, Пропан)
  // За типом идёт разделитель (-, –, —, :) и опционально литры и/или машины
  const fuelRe =
    /^(\d{2,3}|[А-Яа-яЁё]{2,5}(?:-[А-Яа-яЁё])?)\s*[-–—:]\s*(?:(\d+(?:[.,]\d+)?)\s*л)?\s*(?:\/?\s*(\d+(?:[.,]\d+)?)\s*машин)?/i

  // Технические заголовки, которые не должны быть комментарием
  const headerRe = /^остаток топлива на\s+\d{1,2}:\d{2}\s*:?\s*$/i

  for (const line of lines) {
    // Пропускаем технический заголовок «Остаток топлива на 13:00:»
    if (headerRe.test(line)) continue

    const m = line.match(fuelRe)
    if (m && (m[2] || m[3])) {
      // Строка распознана как топливо, только если есть хотя бы литры ИЛИ машины
      const fuelName = m[1].toUpperCase().replace('Ё', 'Е')
      fuels.push({
        fuel: fuelName,
        liters: m[2] ? parseFloat(m[2].replace(',', '.')) : null,
        cars: m[3] ? parseFloat(m[3].replace(',', '.')) : null,
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

  // Детектор протухшей куки: геопортал вместо records возвращает
  // {SupportESIA: true, login: {mms: [...]}} — это значит, что
  // JSESSIONID не авторизована, нужен вход через Госуслуги.
  if (!json.records && typeof json === 'object' && 'SupportESIA' in json) {
    throw new Error(
      'JSESSIONID протухла или не авторизована (геопортал требует ESIA-вход). ' +
        'Откройте https://3d-geoportal.vologda-city.ru/portal/gasstation в браузере, ' +
        'войддите через Госуслуги, скопируйте JSESSIONID из cookies и вставьте в Настройках дашборда.',
    )
  }

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
  cookieStatus: CookieStatus
}

export type CookieStatus = 'alive' | 'expired' | 'not_set' | 'unknown'

/**
 * Проверить доступность источника данных (platforma35.ru).
 * Лёгкий heartbeat-запрос: GET /communal_economy/azs/api/markers/.
 *
 * Возвращает:
 *  - 'alive'   — API доступен
 *  - 'expired' — API недоступен (упал, нет интернета, изменился формат)
 *  - 'unknown' — не удалось определить
 *
 * Сохраняет статус в Setting.cookieStatus + cookieStatusAt.
 *
 * Историческое название cookieStatus сохранено для совместимости с UI,
 * хотя сейчас это уже не про JSESSIONID, а про доступность источника.
 */
export async function checkCookieStatus(): Promise<CookieStatus> {
  try {
    const markers = await fetchAllPlatforma35()
    if (markers.length > 0) {
      await saveSetting('cookieStatus', 'alive')
      await saveSetting('cookieStatusAt', new Date().toISOString())
      return 'alive'
    }
    // markers пустой — странно, считаем недоступным
    await saveSetting('cookieStatus', 'expired')
    await saveSetting('cookieStatusAt', new Date().toISOString())
    return 'expired'
  } catch {
    await saveSetting('cookieStatus', 'expired')
    await saveSetting('cookieStatusAt', new Date().toISOString())
    return 'expired'
  }
}

/**
 * Главный цикл опроса через platforma35.ru (основной источник).
 *
 * Получает все 9 АЗС одним запросом, без авторизации.
 * Обновляет/создаёт станции (с координатами, логотипами), сохраняет
 * свежий снапшот остатков для каждой.
 *
 * Возвращает отчёт в том же формате, что и legacy-версия через геопортал.
 */
export async function refreshAllStations(): Promise<RefreshResult> {
  const startedAt = new Date()
  const errors: string[] = []
  let stationsFound = 0
  let stationsNew = 0
  let stationsUpdated = 0

  // platforma35 не требует куки — статус всегда 'alive'
  const cookieStatus: CookieStatus = 'alive'

  try {
    const markers = await fetchAllPlatforma35()
    stationsFound = markers.length

    for (const marker of markers) {
      try {
        // Считаем «работающей», если availability_fuel = true
        const status = marker.availability_fuel ? 'Да' : 'Нет'

        // Преобразуем топлива в наш формат
        const fuels = marker.remaining_fuel.map((f) => ({
          fuel: f.type,
          liters: f.remains,
          cars: null, // platforma35 не отдаёт количество машин в структурированном виде
        }))

        const parsed = {
          comment: marker.comment || null,
          fuels,
        }

        // Время последнего обновления
        const sourceUpdatedAt = parsePlatforma35Time(marker.last_update)

        const existing = await db.station.findUnique({
          where: { externalId: marker.id },
        })

        const data = {
          brand: marker.title || 'Без бренда',
          address: marker.address || '',
          status,
          graphId: null, // platforma35 не даёт graphId
          source: 'platforma35',
          longitude: marker.coordinates?.[0] ?? null,
          latitude: marker.coordinates?.[1] ?? null,
          logoUrl: absoluteLogoUrl(marker.logo),
          availabilityFuel: marker.availability_fuel,
        }

        let station: { id: string }
        if (existing) {
          const updated = await db.station.update({
            where: { externalId: marker.id },
            data,
          })
          station = updated
          if (
            existing.brand !== data.brand ||
            existing.address !== data.address ||
            existing.status !== data.status ||
            existing.availabilityFuel !== data.availabilityFuel
          ) {
            stationsUpdated++
          }
        } else {
          station = await db.station.create({
            data: { externalId: marker.id, ...data },
          })
          stationsNew++
        }

        // сохраняем снапшот — только если есть данные (не сохраняем пустые снапшоты каждый опрос)
        if (fuels.length > 0 || marker.comment) {
          await db.fuelSnapshot.create({
            data: {
              stationId: station.id,
              rawDetails: marker.info || '',
              parsedFuels: JSON.stringify(parsed),
              sourceCreatedAt: sourceUpdatedAt,
              sourceUpdatedAt,
            },
          })
        }
      } catch (e) {
        errors.push(
          `АЗС "${marker.title || '?'}" (${marker.address}): ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    // Сохраняем встроенную историю (если её ещё не было в нашей БД)
    await importHistoryFromPlatforma35(markers)

    await saveSetting('lastRefreshAt', new Date().toISOString())
    await saveSetting(
      'lastRefreshSummary',
      JSON.stringify({ stationsFound, stationsNew, stationsUpdated, errorsCount: errors.length }),
    )
    await saveSetting('cookieStatus', 'alive')
    await saveSetting('cookieStatusAt', new Date().toISOString())
  } catch (e) {
    errors.push(
      `Ошибка получения данных с platforma35.ru: ${e instanceof Error ? e.message : String(e)}`,
    )
    await saveSetting('cookieStatus', 'expired')
    await saveSetting('cookieStatusAt', new Date().toISOString())
  }

  return {
    pointsProcessed: 1, // один запрос к platforma35
    stationsFound,
    stationsNew,
    stationsUpdated,
    errors,
    startedAt,
    finishedAt: new Date(),
    cookieStatus,
  }
}

/**
 * Сохранить исторические точки из ответа platforma35 в нашу БД,
 * если их там ещё нет. Platforma35 отдаёт 2-3 точки за день — например:
 *   09.07, 15:30
 *   09.07, 13:00
 *
 * Это полезно при первом опросе или при пропуске нескольких опросов.
 */
async function importHistoryFromPlatforma35(markers: Platforma35Marker[]): Promise<void> {
  for (const marker of markers) {
    if (!marker.history_fuel || marker.history_fuel.length === 0) continue

    const station = await db.station.findUnique({
      where: { externalId: marker.id },
    })
    if (!station) continue

    // Для каждой точки истории — проверяем, есть ли уже снапшот с таким sourceUpdatedAt
    for (const hp of marker.history_fuel) {
      const sourceUpdatedAt = parsePlatforma35Time(hp.time)
      if (!sourceUpdatedAt) continue

      // Проверяем, есть ли уже снапшот с этим временем
      const existing = await db.fuelSnapshot.findFirst({
        where: {
          stationId: station.id,
          sourceUpdatedAt,
        },
      })
      if (existing) continue

      // Создаём снапшот
      const fuels = hp.history.map((f) => ({
        fuel: f.type,
        liters: f.remains,
        cars: null,
      }))
      await db.fuelSnapshot.create({
        data: {
          stationId: station.id,
          rawDetails: '',
          parsedFuels: JSON.stringify({ comment: null, fuels }),
          sourceCreatedAt: sourceUpdatedAt,
          sourceUpdatedAt,
        },
      })
    }
  }
}

export const GEOPORTAL_CONSTANTS = {
  LAYER_ID,
  FACT_DSCR_ID,
  BASE_URL,
  PAGE_PATH,
}
