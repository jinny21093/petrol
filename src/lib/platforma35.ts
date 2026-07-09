/**
 * Клиент публичного API platforma35.ru для получения данных о наличии топлива
 * на АЗС Вологды.
 *
 * Endpoint: GET https://platforma35.ru/communal_economy/azs/api/markers/
 *
 * Возвращает готовый JSON со всеми АЗС города:
 *   {
 *     "success": true,
 *     "markers": [
 *       {
 *         "id": 1,
 *         "logo": "/media/azs/logo/...",
 *         "coordinates": [39.81, 59.21],   // [lng, lat] в WGS84
 *         "title": "Лукойл",
 *         "address": "ул. Преображенского, 38",
 *         "comment": "",
 *         "comment_date": "",
 *         "last_update": "09.07, 15:36",
 *         "remaining_fuel": [{"type": "95", "remains": 13300}, ...],
 *         "availability_fuel": true,
 *         "history_fuel": [{"time": "09.07, 15:36", "history": [...]}, ...],
 *         "info": "95 - 13300 л. / 665 машин<br>..."
 *       },
 *       ...
 *     ]
 *   }
 *
 * Преимущества перед прямым опросом 3d-geoportal.vologda-city.ru:
 *   - Не требует JSESSIONID или ESIA-авторизации
 *   - Отдаёт координаты (на геопортале их не было)
 *   - Уже структурированные данные по топливу (не надо парсить текст)
 *   - Встроенная история за день (несколько снапшотов)
 *   - URL логотипов брендов
 *   - Поле availability_fuel — удобно для быстрой фильтрации
 *
 * Недостатки:
 *   - Обновляется реже, чем геопортал (кажется, раз в 2-3 часа)
 *   - Год в last_update не указан — приходится дополнять текущим годом
 */

const PLATFORMA35_API_URL = 'https://platforma35.ru/communal_economy/azs/api/markers/'
const PLATFORMA35_BASE = 'https://platforma35.ru'

export interface Platforma35Fuel {
  type: string
  remains: number
}

export interface Platforma35HistoryPoint {
  time: string // "09.07, 15:36" — без года
  history: Platforma35Fuel[]
}

export interface Platforma35Marker {
  id: number
  logo: string // путь от корня platforma35, например "/media/azs/logo/..."
  coordinates: [number, number] // [lng, lat] в WGS84
  title: string // бренд
  address: string
  comment: string
  comment_date: string
  last_update: string // "09.07, 15:36" или "" если нет данных
  remaining_fuel: Platforma35Fuel[]
  availability_fuel: boolean
  history_fuel: Platforma35HistoryPoint[]
  info: string // готовый HTML
}

export interface Platforma35Response {
  success: boolean
  markers: Platforma35Marker[]
}

/**
 * Получить все АЗС с platforma35.ru.
 */
export async function fetchAllStations(): Promise<Platforma35Marker[]> {
  const resp = await fetch(PLATFORMA35_API_URL, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
      Accept: 'application/json',
    },
  })
  if (!resp.ok) {
    throw new Error(`platforma35.ru вернул HTTP ${resp.status}`)
  }
  const json = (await resp.json()) as Platforma35Response
  if (!json.success) {
    throw new Error('platforma35.ru вернул success=false')
  }
  return json.markers || []
}

/**
 * Превратить относительный URL логотипа в абсолютный.
 * На platforma35 пути вида "/media/azs/logo/...".
 */
export function absoluteLogoUrl(logo: string): string | null {
  if (!logo) return null
  if (logo.startsWith('http://') || logo.startsWith('https://')) return logo
  return `${PLATFORMA35_BASE}${logo}`
}

/**
 * Распарсить время вида "09.07, 15:36" (без года) в Date.
 * Если строка пустая — вернёт null.
 * Год подставляется текущий (данные platforma35 свежие, не старше суток).
 */
export function parsePlatforma35Time(time: string): Date | null {
  if (!time || !time.trim()) return null
  // "09.07, 15:36" → день.месяц, часы:минуты
  const m = time.match(/^(\d{2})\.(\d{2}),\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1 // JS months 0-indexed
  const hour = parseInt(m[3], 10)
  const minute = parseInt(m[4], 10)
  const now = new Date()
  // Если день в будущем (например, 31 декабря, а сейчас 1 января) — берём прошлый год
  const date = new Date(now.getFullYear(), month, day, hour, minute, 0, 0)
  // Если получившаяся дата больше текущей на >2 дня — это прошлый год
  if (date.getTime() - now.getTime() > 2 * 24 * 3600 * 1000) {
    date.setFullYear(date.getFullYear() - 1)
  }
  return date
}

export const PLATFORMA35_CONSTANTS = {
  API_URL: PLATFORMA35_API_URL,
  BASE_URL: PLATFORMA35_BASE,
}
