# Changelog

Все заметные изменения проекта дашборда АЗС Вологды.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/).

## [1.1.0] — 2026-07-14

### Добавлено
- **CHANGELOG.md** — этот файл
- Поле `fuelDelivery` в модели Station (флаг подвоза топлива от platforma35)
- Парсер количества машин из HTML-поля `info` (`parseCarsFromInfo()`)
- Сохранение `commentDate` (время комментария) в `parsedFuels`
- 3 состояния АЗС в UI: 🟢 работает / 🟡 нет топлива / ⚪ нет данных
- Синий значок "🚛 Ожидается подвоз" при `fuel_delivery=true`
- Заметные жёлтые блоки комментариев с иконкой и относительным временем
- Количество машин в чипах топлива (`333 маш.`, `567 маш.`)

### Изменено
- Footer: ссылка `3d-geoportal.vologda-city.ru` → `platforma35.ru`
- `cookieStatus` переименован в `sourceStatus` (больше не про куки)
- `CookieStatus` тип переименован в `SourceStatus`, убран вариант `'not_set'`
- Ключи в Setting: `cookieStatus` → `sourceStatus`, `cookieStatusAt` → `sourceStatusAt`
- Сортировка снапшотов в `/api/stations`: `fetchedAt desc` → `sourceUpdatedAt desc`
  (фикс: latest-снапшот выбирался неправильно из-за одинакового fetchedAt)
- `processMarker`: при изменении комментария без изменения `sourceUpdatedAt` —
  обновляется существующий снапшот, а не пропускается

### Удалено
- **CoveragePoint** модель + таблица (legacy с геопортала, не используется)
- **`/api/coverage`** и **`/api/coverage/[id]`** routes (мёртвые endpoints)
- **`/api/settings`** route (мёртвый — JSESSIONID больше не нужен)
- **`useCoverage()`** hook (мёртвый, 56 строк)
- **`useSettings()`** hook (мёртвый, 34 строки)
- **`CoveragePanel`** и **`CoverageRow`** компоненты (180 строк)
- **`src/lib/seed.ts`** (сидинг 9 coverage-точек — не нужен)
- Поле `graphId` из модели Station (всегда null для platforma35)
- Поле `totalPoints`/`enabledPoints` из `/api/stats` (coverage удалён)
- Упоминания JSESSIONID, ESIA, Госуслуг, 3d-geoportal из комментариев и UI
- Вызовы `seedDefaultPoints()` из `/api/stats` и `/api/stations`

### Технический долг
- Поле `source` в Station оставлено как audit-поле (всегда `'platforma35'`)
- `parseFuelDetails()` оставлен для перепарсинга старых снапшотов (legacy)
- `cookie-check` route сохраняет историческое имя (cron скрипты зависят от него)

---

## [1.0.0] — 2026-07-10

### Главное
- **Prisma 7** — миграция с v6 на v7 (Direct TCP + `@prisma/adapter-better-sqlite3`)
- **bun:sqlite** — скрипты переписаны с `better-sqlite3` на встроенный `bun:sqlite`
- **Tech debt cleanup** — удалено 6833 строк мёртвого кода, 46 неиспользуемых npm-пакетов

### Добавлено
- `prisma.config.ts` — централизованная конфигурация Prisma CLI для v7
- `dotenv` в devDependencies (Prisma v7 не загружает `.env` автоматически)
- `ARCHITECTURE.md` — описание архитектуры с ASCII-диаграммой
- `scripts/dedup-snapshots.ts` — дедупликация снапшотов по `(stationId, sourceUpdatedAt)`
- `--force` флаг для `update.sh` — принудительная пересборка без новых коммитов

### Изменено
- `schema.prisma`: `provider = "prisma-client-js"` → `"prisma-client"`, `output = "./generated"`
- `src/lib/db.ts`: импорт из `@prisma/client` → `../../prisma/generated/client`, adapter pattern
- Скрипты `.mjs` → `.ts` (обратно на bun, через `bun:sqlite` вместо `better-sqlite3`)
- `update.sh`: переписан без `set -e` (была причина всех падений)
- `update.sh`: автоматический откат `package.json`/`pnpm-lock.yaml` перед `git pull`
- `next.config.ts`: `images.unoptimized: true` (экономит ~30 МБ в standalone)
- `eslint.config.mjs`: ignore `prisma/generated/**`

### Удалено
- 39 неиспользуемых shadcn-ui компонентов (accordion, alert-dialog, avatar, ...)
- `tailwind.config.ts` (мёртвый в Tailwind v4)
- `src/hooks/use-mobile.ts`, `src/hooks/use-toast.ts` (мёртвые)
- Дублирующая toast-система (radix-toast, оставлен только sonner)
- 46 npm-зависимостей: `@dnd-kit/*`, `@hookform/resolvers`, `@mdxeditor/editor`,
  `@reactuses/core`, `@tanstack/*`, `date-fns`, `framer-motion`, `next-auth`,
  `next-intl`, `react-markdown`, `react-syntax-highlighter`, `sharp`, `uuid`,
  `z-ai-web-dev-sdk`, `zod`, `zustand` + 18 radix-ui пакетов

---

## [0.9.0] — 2026-07-09

### Главное
- **Миграция с геопортала на platforma35.ru** — публичный API без авторизации
- **Цветные карточки АЗС** с трендами и логотипами брендов

### Добавлено
- `src/lib/platforma35.ts` — клиент публичного API
- Поля в Station: `longitude`, `latitude`, `logoUrl`, `availabilityFuel`
- Графики истории (Recharts): LineChart по АЗС, AreaChart по городу
- `/api/stations/[id]/history` — история по конкретной АЗС
- `/api/analytics` — агрегированная аналитика по всем АЗС
- Стрелки трендов: ↑ растёт, ↓ падает, — стабильно
- 3-колоночная сетка карточек на десктопе
- Компактная шапка, stat-карты, slim-баннер
- `scripts/install.sh` — автоустановка на Ubuntu 22.04
- `scripts/update.sh` — обновление кода на сервере
- `scripts/cron-refresh.sh` — обёртка для cron
- `scripts/cleanup-duplicates.ts` — удаление дублей станций
- `scripts/reparse-snapshots.ts` — перепарсинг старых снапшотов
- `scripts/test-parser.ts` — тесты парсера (8 кейсов)
- Heartbeat endpoint `/api/cookie-check`
- Cron: heartbeat каждые 5 мин, опрос каждые 10 мин, бэкап в 03:00

### Удалено
- Зависимость от JSESSIONID (требовала ESIA-авторизации через Госуслуги)
- 9 coverage-точек (нужны были только для геопортала)

---

## [0.1.0] — 2026-07-09

### Начало проекта
- Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui
- Prisma ORM + SQLite
- Опрос геопортала 3d-geoportal.vologda-city.ru через JSESSIONID
- 9 coverage-точек для покрытия Вологды
- Базовый дашборд со списком АЗС
- PM2 + Caddy деплой
