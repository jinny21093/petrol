/**
 * Перепарсить все существующие FuelSnapshot.parsedFuels обновлённым парсером.
 *
 * Использование:
 *   bun run scripts/reparse-snapshots.ts
 *
 * Когда запускать:
 *   — После обновления парсера в коде, чтобы применить его к уже накопленным
 *     историческим данным. Иначе старые снапшоты останутся с некорректным
 *     parsedFuels (например, ДТ был в comment, теперь будет в fuels).
 */
import { db } from '../src/lib/db'
import { parseFuelDetails } from '../src/lib/geoportal'

async function main() {
  const total = await db.fuelSnapshot.count()
  console.log(`Перепарсинг ${total} снапшотов...`)

  let updated = 0
  let unchanged = 0
  const cursor: string | null = null
  let skip = 0
  const pageSize = 500

  while (true) {
    const batch = await db.fuelSnapshot.findMany({
      take: pageSize,
      skip,
      cursor: cursor ? { id: cursor } : undefined,
      skipCursor: cursor ? 1 : undefined,
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
