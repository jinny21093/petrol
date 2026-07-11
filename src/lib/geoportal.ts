/**
 * Главный модуль опроса АЗС.
 *
 * Источник данных: публичный API platforma35.ru
 *   GET https://platforma35.ru/communal_economy/azs/api/markers/
 *   - без авторизации
 *   - отдаёт сразу все 9 АЗС Вологды
 *   - уже структурированные данные (тип топлива → литры)
 *   - координаты, логотипы, история за день
 *
 * Историческая справка: раньше использовался геопортал
 * 3d-geoportal.vologda-city.ru, но он требовал ESIA-авторизацию
 * (Госуслуги) и кука JSESSIONID постоянно протухала. От геопортала
 * отказались в пользу platforma35.ru.
 *
 * Функции:
 *   - refreshAllStations() — главный цикл опроса, сохраняет снапшоты в БД
 *   - checkCookieStatus() — лёгкая проверка доступности источника
 *   - parseFuelDetails() — парсер сырого текста (используется в reparse-скриптах
 *     для старых данных, оставшихся с времён геопортала)
 */

import { db } from '@/lib/db'
import {
  fetchAllStations as fetchAllPlatforma35,
  absoluteLogoUrl,
  parsePlatforma35Time,
  parseCarsFromInfo,
  type Platforma35Marker,
} from '@/lib/platforma35'

// -------- Утилиты для работы с настройками в БД --------

async function saveSetting(id: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { id },
    create: { id, value },
    update: { value },
  })
}

// -------- Парсер текста топлива (legacy, для перепарсинга старых данных) --------

/**
 * Парсит текст деталей топлива (поле 6920 с геопортала) в структурированный массив.
 *
 * Примеры текста:
 *   Остаток топлива на 10:00:\n92 -  5000 л / 250 машин\n95 - 17700 л / 885 машин
 *   Ожидается подвоз в 10:30\n95 - 11100 л / 555 машин\n92 - 6100 л / 305 машин
 *   Остаток топлива на 13:00:\nДТ - 1066 машин\n92 - 700 машин\n95 - 400 машин
 *
 * Используется только в scripts/reparse-snapshots.{ts,mjs} для приведения
 * старых снапшотов (с геопортала) к единому формату с новыми (с platforma35).
 * Для свежих данных platforma35 парсинг не нужен — API отдаёт уже JSON.
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
  const fuelRe =
    /^(\d{2,3}|[А-Яа-яЁё]{2,5}(?:-[А-Яа-яЁё])?)\s*[-–—:]\s*(?:(\d+(?:[.,]\d+)?)\s*л)?\s*(?:\/?\s*(\d+(?:[.,]\d+)?)\s*машин)?/i

  const headerRe = /^остаток топлива на\s+\d{1,2}:\d{2}\s*:?\s*$/i

  for (const line of lines) {
    if (headerRe.test(line)) continue
    const m = line.match(fuelRe)
    if (m && (m[2] || m[3])) {
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

// -------- Типы --------

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

/**
 * Статус источника данных.
 * Исторически назывался cookieStatus (когда использовался геопортал с JSESSIONID).
 * Сейчас это просто индикатор доступности platforma35.ru:
 *   - 'alive'   — API доступен
 *   - 'expired' — API недоступен (упал, нет интернета, изменился формат)
 *   - 'not_set' — больше не используется (было: JSESSIONID не задана)
 *   - 'unknown' — не удалось определить
 */
export type CookieStatus = 'alive' | 'expired' | 'not_set' | 'unknown'

// -------- Проверка доступности источника --------

/**
 * Лёгкая проверка доступности platforma35.ru — делает один GET к API.
 * Сохраняет статус в Setting.cookieStatus + cookieStatusAt (для отображения в UI).
 *
 * Cron дёргает этот endpoint каждые 5 минут — это и heartbeat, и индикатор
 * здоровья для баннера в дашборде.
 */
export async function checkCookieStatus(): Promise<CookieStatus> {
  try {
    const markers = await fetchAllPlatforma35()
    if (markers.length > 0) {
      await saveSetting('cookieStatus', 'alive')
      await saveSetting('cookieStatusAt', new Date().toISOString())
      return 'alive'
    }
    await saveSetting('cookieStatus', 'expired')
    await saveSetting('cookieStatusAt', new Date().toISOString())
    return 'expired'
  } catch {
    await saveSetting('cookieStatus', 'expired')
    await saveSetting('cookieStatusAt', new Date().toISOString())
    return 'expired'
  }
}

// -------- Главный цикл опроса --------

/**
 * Получить все АЗС с platforma35.ru одним запросом, обновить/создать записи
 * в БД, сохранить свежие снапшоты остатков, импортировать встроенную историю.
 *
 * Возвращает отчёт о результатах опроса.
 */
export async function refreshAllStations(): Promise<RefreshResult> {
  const startedAt = new Date()
  const errors: string[] = []
  let stationsFound = 0
  let stationsNew = 0
  let stationsUpdated = 0
  const cookieStatus: CookieStatus = 'alive'

  try {
    const markers = await fetchAllPlatforma35()
    stationsFound = markers.length

    for (const marker of markers) {
      try {
        await processMarker(marker, (isNew, isUpdated) => {
          if (isNew) stationsNew++
          else if (isUpdated) stationsUpdated++
        })
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
    pointsProcessed: 1,
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
 * Обновить или создать станцию по данным маркера platforma35,
 * сохранить свежий снапшот остатков.
 *
 * Логика сохранения снапшота:
 *   1. Если sourceUpdatedAt (last_update) изменился → создаём новый снапшот
 *   2. Если sourceUpdatedAt тот же, но comment или comment_date изменились →
 *      обновляем parsedFuels в существующем снапшоте (комментарий — это
 *      оперативная информация, не нужно терять)
 *   3. Если ничего не изменилось → пропускаем (дедупликация)
 */
async function processMarker(
  marker: Platforma35Marker,
  onResult: (isNew: boolean, isUpdated: boolean) => void,
): Promise<void> {
  const status = marker.availability_fuel ? 'Да' : 'Нет'

  // Парсим количество машин из HTML-поля info
  const fuelTypes = marker.remaining_fuel.map((f) => f.type)
  const carsByType = parseCarsFromInfo(marker.info || '', fuelTypes)

  const fuels = marker.remaining_fuel.map((f) => ({
    fuel: f.type,
    liters: f.remains,
    cars: carsByType[f.type] ?? null,
  }))

  const commentDate = parsePlatforma35Time(marker.comment_date)

  const parsed = {
    comment: marker.comment || null,
    commentDate: commentDate?.toISOString() || null,
    fuelDelivery: marker.fuel_delivery || false,
    fuels,
  }

  const sourceUpdatedAt = parsePlatforma35Time(marker.last_update)

  const existing = await db.station.findUnique({
    where: { externalId: marker.id },
  })

  const data = {
    brand: marker.title || 'Без бренда',
    address: marker.address || '',
    status,
    graphId: null,
    source: 'platforma35',
    longitude: marker.coordinates?.[0] ?? null,
    latitude: marker.coordinates?.[1] ?? null,
    logoUrl: absoluteLogoUrl(marker.logo),
    availabilityFuel: marker.availability_fuel,
    fuelDelivery: marker.fuel_delivery || false,
  }

  let station: { id: string }
  if (existing) {
    station = await db.station.update({
      where: { externalId: marker.id },
      data,
    })
    const isUpdated =
      existing.brand !== data.brand ||
      existing.address !== data.address ||
      existing.status !== data.status ||
      existing.availabilityFuel !== data.availabilityFuel ||
      existing.fuelDelivery !== data.fuelDelivery
    onResult(false, isUpdated)
  } else {
    station = await db.station.create({
      data: { externalId: marker.id, ...data },
    })
    onResult(true, false)
  }

  // Сохраняем снапшот только если есть данные (не сохраняем пустые каждый опрос)
  if (fuels.length === 0 && !marker.comment) return

  if (!sourceUpdatedAt) {
    // Нет sourceUpdatedAt — нечего дедуплицировать, просто создаём
    await db.fuelSnapshot.create({
      data: {
        stationId: station.id,
        rawDetails: marker.info || '',
        parsedFuels: JSON.stringify(parsed),
        sourceCreatedAt: sourceUpdatedAt,
        sourceUpdatedAt,
      },
    })
    return
  }

  // Ищем существующий снапшот с таким же sourceUpdatedAt
  const existingSnap = await db.fuelSnapshot.findFirst({
    where: { stationId: station.id, sourceUpdatedAt },
  })

  if (!existingSnap) {
    // Новый снапшот — создаём
    await db.fuelSnapshot.create({
      data: {
        stationId: station.id,
        rawDetails: marker.info || '',
        parsedFuels: JSON.stringify(parsed),
        sourceCreatedAt: sourceUpdatedAt,
        sourceUpdatedAt,
      },
    })
    return
  }

  // Снапшот уже есть. Проверяем — не изменился ли комментарий?
  // (бывает, что platforma35 обновляет comment, не трогая last_update)
  let existingParsed: { comment?: string | null; commentDate?: string | null; fuelDelivery?: boolean }
  try {
    existingParsed = JSON.parse(existingSnap.parsedFuels)
  } catch {
    existingParsed = {}
  }

  const oldComment = existingParsed.comment ?? null
  const newComment = parsed.comment
  const oldCommentDate = existingParsed.commentDate ?? null
  const newCommentDate = parsed.commentDate
  const oldFuelDelivery = existingParsed.fuelDelivery ?? false
  const newFuelDelivery = parsed.fuelDelivery

  if (
    oldComment !== newComment ||
    oldCommentDate !== newCommentDate ||
    oldFuelDelivery !== newFuelDelivery
  ) {
    // Комментарий или флаг подвоза изменились — обновляем существующий снапшот
    await db.fuelSnapshot.update({
      where: { id: existingSnap.id },
      data: { parsedFuels: JSON.stringify(parsed) },
    })
  }
  // Если ничего не изменилось — пропускаем (дедупликация)
}

/**
 * Сохранить исторические точки из ответа platforma35 в нашу БД,
 * если их там ещё нет. Platforma35 отдаёт 2-9 точек за последние сутки — например:
 *   10.07, 11:17   ← последняя (часто совпадает с marker.last_update)
 *   10.07, 08:20
 *   09.07, 22:11
 *   ...
 *
 * ВАЖНО: первая точка history_fuel обычно дублирует marker.last_update —
 * её уже сохранил processMarker. Пропускаем такую точку, чтобы не плодить дубли.
 *
 * Дедупликация по sourceUpdatedAt: если в БД уже есть снапшот с тем же
 * временем — не создаём новый.
 */
async function importHistoryFromPlatforma35(markers: Platforma35Marker[]): Promise<void> {
  for (const marker of markers) {
    if (!marker.history_fuel || marker.history_fuel.length === 0) continue

    const station = await db.station.findUnique({
      where: { externalId: marker.id },
    })
    if (!station) continue

    // Время последнего обновления из маркера — эту точку уже сохранил processMarker
    const lastUpdateTime = parsePlatforma35Time(marker.last_update)

    for (const hp of marker.history_fuel) {
      const sourceUpdatedAt = parsePlatforma35Time(hp.time)
      if (!sourceUpdatedAt) continue

      // Пропускаем точку, совпадающую с last_update (уже сохранена в processMarker)
      if (lastUpdateTime && sourceUpdatedAt.getTime() === lastUpdateTime.getTime()) continue

      // Проверяем, есть ли уже снапшот с этим временем
      const existing = await db.fuelSnapshot.findFirst({
        where: { stationId: station.id, sourceUpdatedAt },
      })
      if (existing) continue

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
