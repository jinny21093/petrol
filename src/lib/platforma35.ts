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
  comment_date: string // "11.07, 10:58" — когда был добавлен комментарий
  last_update: string // "09.07, 15:36" или "" если нет данных
  remaining_fuel: Platforma35Fuel[]
  availability_fuel: boolean
  fuel_delivery: boolean // true если ожидается/идёт подвоз топлива
  history_fuel: Platforma35HistoryPoint[]
  info: string // готовый HTML вида "95 - 13300 л. / 665 машин<br>..."
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

/**
 * Распарсить количество машин по типу топлива из HTML-поля `info`.
 *
 * Поле info имеет вид:
 *   "100 - нет<br>95 - 17000 л. / 567 машин<br>92 - 10000 л. / 333 машин"
 *   "95 - 13300 л. / 665 машин"
 *   "100 - нет<br>92 - нет<br>95 - нет"
 *
 * Возвращает Map: тип топлива → количество машин (или null, если не указано).
 * Например: { "95" => 567, "92" => 333, "100" => null }
 *
 * Если топлива нет ("95 - нет") — машины тоже null.
 */
export function parseCarsFromInfo(
  info: string,
  fuelTypes: string[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  if (!info) {
    for (const t of fuelTypes) result[t] = null
    return result
  }

  // Разбиваем по <br> на строки
  const lines = info.split(/<br\s*\/?>/i)

  for (const ft of fuelTypes) {
    // Ищем строку вида "92 - 10000 л. / 333 машин" или "92 - нет"
    // Возможные форматы:
    //   "92 - 10000 л. / 333 машин"
    //   "92 - 10000 л. / 333 машин" (с точкой после "л")
    //   "92 - нет"
    //   "92 - 5000 л"
    const re = new RegExp(`${ft}\\s*-\\s*(\\d+[\\d.,]*\\s*л\\.?\\s*(?:/\\s*(\\d+)\\s*машин)?|нет)`, 'i')
    let cars: number | null = null
    for (const line of lines) {
      const m = line.match(re)
      if (m) {
        if (m[1].toLowerCase() === 'нет') {
          cars = null
        } else if (m[2]) {
          cars = parseInt(m[2], 10)
        } else {
          // есть литры, но нет машин
          cars = null
        }
        break
      }
    }
    result[ft] = cars
  }

  return result
}

export const PLATFORMA35_CONSTANTS = {
  API_URL: PLATFORMA35_API_URL,
  BASE_URL: PLATFORMA35_BASE,
}
