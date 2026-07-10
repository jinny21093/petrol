import { db } from '@/lib/db'

/**
 * Дефолтные 9 coverage-точек для Вологды.
 * Ссылка на исходные координаты из рабочего скрипта DeepSeek.
 */
const DEFAULT_POINTS = [
  { name: 'Центр-1', mapX: 8227460.1349501945, mapY: 4431792.655405244 },
  { name: 'Центр-2', mapX: 8225546.229637418, mapY: 4432475.872273847 },
  { name: 'Центр-3', mapX: 8224042.445960419, mapY: 4432475.872273847 },
  { name: 'Север-1', mapX: 8224247.506778307, mapY: 4433364.056288045 },
  { name: 'Юг-1', mapX: 8220146.279990578, mapY: 4441016.083131396 },
  { name: 'Юг-2', mapX: 8218779.204394667, mapY: 4441084.403775751 },
  { name: 'Восток-1', mapX: 8234773.98990981, mapY: 4440811.115985803 },
  { name: 'Восток-2', mapX: 8233201.853496012, mapY: 4441426.012210052 },
  { name: 'Заречье', mapX: 8219599.450273711, mapY: 4447711.610528727 },
]

let seedPromise: Promise<void> | null = null

/**
 * Заполняет БД дефолтными coverage-точками, если таблица пуста.
 * Безопасно вызывать многократно, в том числе из параллельных запросов —
 * использует in-memory мьютекс + sentinel-запись в Setting, чтобы избежать
 * двойной вставки при Race Condition (React Strict Mode / параллельные fetch).
 */
export async function seedDefaultPoints(): Promise<void> {
  if (seedPromise) return seedPromise
  seedPromise = (async () => {
    try {
      // Sentinel через транзакцию: если запись "default_points_seeded" уже есть — выходим
      const sentinel = await db.setting.findUnique({
        where: { id: 'default_points_seeded' },
      })
      if (sentinel) return

      const count = await db.coveragePoint.count()
      if (count > 0) {
        await db.setting.upsert({
          where: { id: 'default_points_seeded' },
          create: { id: 'default_points_seeded', value: '1' },
          update: { value: '1' },
        })
        return
      }

      await db.$transaction([
        db.coveragePoint.createMany({
          data: DEFAULT_POINTS.map((p) => ({ ...p, scale: 156093.8619923378 })),
        }),
        db.setting.upsert({
          where: { id: 'default_points_seeded' },
          create: { id: 'default_points_seeded', value: '1' },
          update: { value: '1' },
        }),
      ])
    } finally {
      seedPromise = null
    }
  })()
  return seedPromise
}
