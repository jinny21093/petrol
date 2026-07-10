/**
 * Перепарсить все существующие FuelSnapshot.parsedFuels обновлённым парсером.
 *
 * Использование:
 *   node scripts/reparse-snapshots.mjs
 *
 * ВНИМАНИЕ: после миграции на Prisma v7 с Direct TCP + better-sqlite3,
 * bun не поддерживает native модуль better-sqlite3. Этот скрипт работает
 * через node + better-sqlite3 напрямую (без Prisma), чтобы можно было
 * запускать его где угодно — через node или bun.
 */

import Database from 'better-sqlite3'

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db'
const db = new Database(dbPath)

/**
 * Парсит текст деталей топлива в структурированный массив.
 * (Дублировано из src/lib/geoportal.ts — см. комментарий в скрипте)
 */
function parseFuelDetails(raw) {
  if (!raw) return { comment: null, fuels: [] }
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const fuels = []
  const commentLines = []
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

const total = db.prepare('SELECT COUNT(*) as c FROM FuelSnapshot').get().c
console.log(`Перепарсинг ${total} снапшотов...`)

const rows = db.prepare('SELECT id, rawDetails, parsedFuels FROM FuelSnapshot ORDER BY id ASC').all()

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
