/**
 * Cleanup дубликатов станций после миграции с геопортала на platforma35.
 *
 * Использование:
 *   node scripts/cleanup-duplicates.mjs
 *
 * ВНИМАНИЕ: после миграции на Prisma v7 с Direct TCP + better-sqlite3,
 * bun не поддерживает native модуль better-sqlite3. Этот скрипт работает
 * через node + better-sqlite3 напрямую (без Prisma).
 */

import Database from 'better-sqlite3'

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db'
const db = new Database(dbPath)

console.log('Cleanup дубликатов станций...\n')

const allStations = db
  .prepare(
    `SELECT id, externalId, brand, address, source, longitude, latitude
     FROM Station ORDER BY createdAt ASC`,
  )
  .all()
console.log(`Всего АЗС в БД: ${allStations.length}`)

const normAddr = (s) =>
  s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ул\./, 'ул.')
    .replace(/ш\./, 'ш.')
    .trim()

const byAddr = new Map()
for (const s of allStations) {
  const key = normAddr(s.address)
  if (!byAddr.has(key)) byAddr.set(key, [])
  byAddr.get(key).push(s)
}

let duplicatesFound = 0
let snapshotsMoved = 0
let stationsDeleted = 0

const updateSnapshotsStmt = db.prepare(
  'UPDATE FuelSnapshot SET stationId = ? WHERE stationId = ?',
)
const countSnapshotsStmt = db.prepare(
  'SELECT COUNT(*) as c FROM FuelSnapshot WHERE stationId = ?',
)
const deleteStationStmt = db.prepare('DELETE FROM Station WHERE id = ?')

for (const [addr, stations] of byAddr.entries()) {
  if (stations.length < 2) continue

  duplicatesFound++
  console.log(`\nДубликаты по адресу "${addr}":`)
  for (const s of stations) {
    console.log(
      `  id=${s.id}  externalId=${s.externalId}  source=${s.source || 'null'}  brand=${s.brand}`,
    )
  }

  // Prefer с координатами (это реально новая от platforma35)
  const withCoords = stations.find(
    (s) => s.longitude !== null && s.latitude !== null,
  )
  const platforma35 = stations.find((s) => s.source === 'platforma35')
  const keeper = withCoords || platforma35 || stations[0]
  const losers = stations.filter((s) => s.id !== keeper.id)

  console.log(`  → оставляем: id=${keeper.id} (source=${keeper.source || 'null'})`)

  for (const loser of losers) {
    const snapCount = countSnapshotsStmt.get(loser.id).c
    if (snapCount > 0) {
      updateSnapshotsStmt.run(keeper.id, loser.id)
      console.log(`  → перенесено ${snapCount} снапшотов с id=${loser.id} на id=${keeper.id}`)
      snapshotsMoved += snapCount
    }
    deleteStationStmt.run(loser.id)
    console.log(`  → удалена станция id=${loser.id}`)
    stationsDeleted++
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Готово!`)
console.log(`  Адресов с дубликатами: ${duplicatesFound}`)
console.log(`  Снапшотов перенесено:  ${snapshotsMoved}`)
console.log(`  Станций удалено:       ${stationsDeleted}`)

const finalCount = db.prepare('SELECT COUNT(*) as c FROM Station').get().c
console.log(`  Станций в БД: было ${allStations.length} → стало ${finalCount}`)

db.close()
