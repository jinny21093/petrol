/**
 * Удалить дублирующие снапшоты (одинаковое stationId + sourceUpdatedAt).
 *
 * После фикса importHistoryFromPlatforma35 новые дубли не появляются,
 * но старые (созданные до фикса) нужно убрать.
 *
 * Запуск:
 *   bun run scripts/dedup-snapshots.ts
 */
import { Database } from 'bun:sqlite'

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db'
const db = new Database(dbPath)

console.log('Удаление дублей снапшотов...\n')

// Найти все группы (stationId, sourceUpdatedAt) с >1 записью
const dupes = db
  .prepare(
    `SELECT stationId, sourceUpdatedAt, COUNT(*) as c
     FROM FuelSnapshot
     WHERE sourceUpdatedAt IS NOT NULL
     GROUP BY stationId, sourceUpdatedAt
     HAVING c > 1`,
  )
  .all() as { stationId: string; sourceUpdatedAt: string; c: number }[]

console.log(`Найдено групп с дублями: ${dupes.length}`)

let totalDeleted = 0
const findIds = db.prepare(
  `SELECT id FROM FuelSnapshot
   WHERE stationId = ? AND sourceUpdatedAt = ?
   ORDER BY fetchedAt DESC`,
)
const deleteStmt = db.prepare('DELETE FROM FuelSnapshot WHERE id = ?')

for (const d of dupes) {
  const ids = findIds.all(d.stationId, d.sourceUpdatedAt) as { id: string }[]
  // Оставляем первую (самую свежую по fetchedAt), удаляем остальные
  const idsToDelete = ids.slice(1)
  for (const { id } of idsToDelete) {
    deleteStmt.run(id)
    totalDeleted++
  }
  console.log(
    `  station=${d.stationId.slice(-8)}  time=${d.sourceUpdatedAt}  было=${d.c}  удалено=${idsToDelete.length}`,
  )
}

console.log(`\nГотово! Удалено: ${totalDeleted}`)

const total = (db.prepare('SELECT COUNT(*) as c FROM FuelSnapshot').get() as { c: number }).c
console.log(`Снапшотов в БД: ${total}`)

db.close()
