/**
 * Перепарсить все существующие FuelSnapshot.parsedFuels обновлённым парсером.
 *
 * Использование:
 *   node scripts/reparse-snapshots.mjs
 *   # или через pnpm:
 *   pnpm exec node scripts/reparse-snapshots.mjs
 *
 * Когда запускать:
 *   — После обновления парсера в коде, чтобы применить его к уже накопленным
 *     историческим данным. Иначе старые снапшоты останутся с некорректным
 *     parsedFuels (например, ДТ был в comment, теперь будет в fuels).
 *
 * ВНИМАНИЕ: этот файл содержит КОПИЮ парсера из src/lib/geoportal.ts.
 * При изменении парсера — обновляйте и этот файл тоже! Запускайте тесты:
 *   pnpm exec bun run scripts/test-parser.ts   # проверяет TS-версию
 *   pnpm exec node scripts/test-parser.mjs     # проверяет эту JS-версию
 *
 * Скрипт написан на чистом ES Modules (без TypeScript), чтобы запускаться
 * через node напрямую — без зависимости от bun или ts-node.
 */
import { PrismaClient } from '@prisma/client'

/**
 * Парсит текст деталей топлива (поле 6920) в структурированный массив.
 *
 * Примеры текста с геопортала:
 *   Остаток топлива на 10:00:\n92 -  5000 л / 250 машин\n95 - 17700 л / 885 машин
 *   Ожидается подвоз в 10:30\n95 - 11100 л / 555 машин\n92 - 6100 л / 305 машин
 *   Остаток топлива на 13:00:\nДТ - 1066 машин\n92 - 700 машин\n95 - 400 машин
 */
function parseFuelDetails(raw) {
  if (!raw) return { comment: null, fuels: [] }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const fuels = []
  const commentLines = []

  // Тип топлива: 2-3 цифры (92, 95, 100) ИЛИ буквы (ДТ, ДТ-З, Газ, СУГ, Пропан)
  const fuelRe =
    /^(\d{2,3}|[А-Яа-яЁё]{2,5}(?:-[А-Яа-яЁё])?)\s*[-–—:]\s*(?:(\d+(?:[.,]\d+)?)\s*л)?\s*(?:\/?\s*(\d+(?:[.,]\d+)?)\s*машин)?/i

  // Технические заголовки, которые не должны быть комментарием
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

const db = new PrismaClient()

async function main() {
  const total = await db.fuelSnapshot.count()
  console.log(`Перепарсинг ${total} снапшотов...`)

  let updated = 0
  let unchanged = 0
  let skip = 0
  const pageSize = 500

  while (true) {
    const batch = await db.fuelSnapshot.findMany({
      take: pageSize,
      skip,
      orderBy: { id: 'asc' },
    })
    if (batch.length === 0) break

    for (const sn of batch) {
      const newParsed = parseFuelDetails(sn.rawDetails)
      const newJson = JSON.stringify(newParsed)
      if (newJson !== sn.parsedFuels) {
        await db.fuelSnapshot.update({
          where: { id: sn.id },
          data: { parsedFuels: newJson },
        })
        updated++
      } else {
        unchanged++
      }
    }

    skip += pageSize
    console.log(`  обработано ${Math.min(skip, total)} / ${total}`)
    if (batch.length < pageSize) break
  }

  console.log(`\nГотово.`)
  console.log(`  обновлено:  ${updated}`)
  console.log(`  без измен:  ${unchanged}`)
  console.log(`  всего:      ${total}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
