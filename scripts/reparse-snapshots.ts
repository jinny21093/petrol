/**
 * Перепарсить все существующие FuelSnapshot.parsedFuels обновлённым парсером.
 *
 * Запуск:
 *   bun run scripts/reparse-snapshots.ts
 *   # или через pnpm:
 *   pnpm reparse
 *
 * Использует bun:sqlite (встроенный SQLite в bun) — не требует native
 * модуля better-sqlite3. Это позволяет запускать скрипт через bun напрямую.
 *
 * Когда запускать:
 *   — После обновления парсера в коде, чтобы применить его к уже накопленным
 *     историческим данным. Иначе старые снапшоты останутся с некорректным
 *     parsedFuels.
 */

import { Database } from 'bun:sqlite'

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db'
const db = new Database(dbPath)

/**
 * Парсит текст деталей топлива (поле 6920) в структурированный массив.
 * (Дублировано из src/lib/geoportal.ts — для автономности скрипта)
 */
function parseFuelDetails(raw: string): {
  comment: string | null
  fuels: { fuel: string; liters: number | null; cars: number | null }[]
} {
  if (!raw) return { comment: null, fuels: [] }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const fuels: { fuel: string; liters: number | null; cars: number | null }[] = []
  const commentLines: string[] = []

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

const total = (db.prepare('SELECT COUNT(*) as c FROM FuelSnapshot').get() as { c: number }).c
console.log(`Перепарсинг ${total} снапшотов...`)

const rows = db.prepare('SELECT id, rawDetails, parsedFuels FROM FuelSnapshot ORDER BY id ASC').all() as {
  id: string
  rawDetails: string
  parsedFuels: string
}[]

let updated = 0
let unchanged = 0
const updateStmt = db.prepare('UPDATE FuelSnapshot SET parsedFuels = ? WHERE id = ?')

for (const row of rows) {
  const newParsed = parseFuelDetails(row.rawDetails || '')
  const newJson = JSON.stringify(newParsed)
  if (newJson !== row.parsedFuels) {
    updateStmt.run(newJson, row.id)
    updated++
  } else {
    unchanged++
  }
}

console.log(`\nГотово.`)
console.log(`  обновлено:  ${updated}`)
console.log(`  без измен:  ${unchanged}`)
console.log(`  всего:      ${total}`)

db.close()
