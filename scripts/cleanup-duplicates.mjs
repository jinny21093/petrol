/**
 * Cleanup дубликатов станций после миграции с геопортала на platforma35.
 *
 * Проблема: после переключения источника данных в БД остались старые АЗС
 * с externalId от геопортала (1-11), а новые с platforma35 имеют
 * externalId=1-9. Получаются дубли по адресам.
 *
 * Что делает скрипт:
 *   1. Находит все АЗС с source='platforma35' (новые, правильные)
 *   2. Для каждой такой АЗС ищет старую с тем же адресом (source='geoportal' или null)
 *   3. Переносит все FuelSnapshot со старой станции на новую
 *   4. Удаляет старую станцию
 *
 * Запуск:
 *   node scripts/cleanup-duplicates.mjs
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Cleanup дубликатов станций...\n')

  const allStations = await db.station.findMany({
    orderBy: { createdAt: 'asc' },
  })
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

  for (const [addr, stations] of byAddr.entries()) {
    if (stations.length < 2) continue

    duplicatesFound++
    console.log(`\nДубликаты по адресу "${addr}":`)
    for (const s of stations) {
      console.log(
        `  id=${s.id}  externalId=${s.externalId}  source=${s.source || 'null'}  brand=${s.brand}`,
      )
    }

    const withCoords = stations.find((s) => s.longitude !== null && s.latitude !== null)
    const platforma35 = stations.find((s) => s.source === 'platforma35')
    const keeper = withCoords || platforma35 || stations[0]
    const losers = stations.filter((s) => s.id !== keeper.id)

    console.log(`  → оставляем: id=${keeper.id} (source=${keeper.source || 'null'})`)

    for (const loser of losers) {
      const snapCount = await db.fuelSnapshot.count({
        where: { stationId: loser.id },
      })
      if (snapCount > 0) {
        await db.fuelSnapshot.updateMany({
          where: { stationId: loser.id },
          data: { stationId: keeper.id },
        })
        console.log(`  → перенесено ${snapCount} снапшотов с id=${loser.id} на id=${keeper.id}`)
        snapshotsMoved += snapCount
      }
      await db.station.delete({ where: { id: loser.id } })
      console.log(`  → удалена станция id=${loser.id}`)
      stationsDeleted++
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Готово!`)
  console.log(`  Адресов с дубликатами: ${duplicatesFound}`)
  console.log(`  Снапшотов перенесено:  ${snapshotsMoved}`)
  console.log(`  Станций удалено:       ${stationsDeleted}`)

  const finalCount = await db.station.count()
  console.log(`  Станций в БД: было ${allStations.length} → стало ${finalCount}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
