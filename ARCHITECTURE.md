# Архитектура проекта

## Обзор

Дашборд мониторинга наличия топлива на АЗС Вологды. One-page приложение
на Next.js 16 (App Router) с SQLite-базой и автоматическим опросом
публичного API platforma35.ru через cron.

```
┌─────────────────────────────────────────────────────────────┐
│                       Браузер пользователя                    │
│                 (http://10.147.17.248 или домен)              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/HTTPS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                          Caddy                                │
│  - reverse_proxy на 127.0.0.1:3000                           │
│  - gzip/zstd сжатие                                          │
│  - Let's Encrypt сертификат (для домена)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP на :3000
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js standalone (PM2 процесс)                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Frontend (page.tsx)                                   │  │
│  │  - Stat-карты, сетка карточек АЗС                      │  │
│  │  - Графики (Recharts)                                  │  │
│  │  - React hooks (useStations, useAnalytics и т.д.)       │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  API Routes (/api/*)                                   │  │
│  │  - /api/stations   — список АЗС + тренды               │  │
│  │  - /api/refresh    — опрос platforma35                 │  │
│  │  - /api/analytics  — агрегаты для графиков             │  │
│  │  - /api/cookie-check — heartbeat                       │  │
│  │  - /api/stats, /api/settings — сервисные              │  │
│  └───────────────────────┬────────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
┌──────────────────────┐      ┌───────────────────────────┐
│   SQLite (custom.db) │      │  platforma35.ru API       │
│                      │      │                           │
│  Station (9 АЗС)     │      │  GET /communal_economy/   │
│  FuelSnapshot (~600) │◀─────│      azs/api/markers/     │
│  Setting             │      │                           │
│  CoveragePoint (0)   │      │  Без авторизации          │
│                      │      │  9 АЗС одним запросом     │
└──────────────────────┘      └───────────────────────────┘
            ▲
            │ cron (каждые 10 мин)
            │
┌─────────────────────────────────────────────────────────────┐
│                     cron (пользователь jin)                   │
│  */5 *  * * *  → GET /api/cookie-check  (heartbeat)          │
│  */10 * * * *  → bash cron-refresh.sh   (полный опрос)       │
│  0 3   * * *   → sqlite3 .backup        (бэкап БД)           │
└─────────────────────────────────────────────────────────────┘
```

## Поток данных

### Опрос platforma35 (каждые 10 минут через cron)

1. `cron-refresh.sh` делает GET `/api/cookie-check` — лёгкая проверка,
   что API доступен (1 запрос к platforma35, обновляет cookieStatus в БД)
2. Если статус `alive` — делает POST `/api/refresh`
3. `refreshAllStations()` в `src/lib/geoportal.ts`:
   - Вызывает `fetchAllStations()` из `src/lib/platforma35.ts`
   - Получает JSON с 9 маркерами АЗС
   - Для каждой АЗС: upsert в таблицу `Station` (с координатами, логотипом,
     availabilityFuel)
   - Если есть остатки — создаёт `FuelSnapshot` с распарсенными топливами
   - Импортирует встроенную историю (2-3 точки за день), если их ещё нет
4. Сохраняет `lastRefreshAt` и `cookieStatus` в `Setting`

### Запрос списка АЗС (при открытии дашборда)

1. Браузер делает GET `/api/stations`
2. Backend возвращает все 9 АЗС с двумя последними снапшотами на каждую
   (для расчёта трендов: ↑ растёт, ↓ падает, — стабильно)
3. Frontend рендерит сетку 3×3 с цветной индикацией

### Просмотр графика по конкретной АЗС

1. Клиент по клику на «История» открывает диалог
2. Делает GET `/api/stations/[id]/history?hours=24`
3. Backend возвращает массив точек `{fetchedAt, fuels: {"92": 5000, "95": 8000}}`
4. Frontend рендерит LineChart через Recharts

### Аналитика по городу (таб «Аналитика»)

1. GET `/api/analytics?hours=24`
2. Backend группирует все снапшоты за период по 10-минутным корзинам
   (для >24ч — по часовым)
3. Для каждой корзины суммирует литры по каждому типу топлива
4. Frontend рендерит AreaChart + LineChart работающих АЗС

## Структура БД

### Station (9 строк)
Основная информация об АЗС. Обновляется при каждом опросе.

| Поле | Тип | Описание |
|---|---|---|
| id | String (cuid) | PK |
| externalId | Int | id маркера с platforma35 (1-9) |
| brand | String | «Лукойл», «Газпромнефть» |
| address | String | «ул. Маршала Конева, 32» |
| status | String | «Да» (availabilityFuel=true) / «Нет» |
| source | String | «platforma35» (или «geoportal» для legacy) |
| longitude | Float? | WGS84 (от platforma35) |
| latitude | Float? | WGS84 (от platforma35) |
| logoUrl | String? | URL логотипа бренда |
| availabilityFuel | Boolean | true = АЗС сообщает об остатках |
| hidden | Boolean | вручную скрытые (не используется) |

### FuelSnapshot (~600 строк, растёт)
История остатков. Один опрос = 0-9 снапшотов (по числу АЗС с данными).

| Поле | Тип | Описание |
|---|---|---|
| id | String (cuid) | PK |
| stationId | String | FK → Station |
| rawDetails | String | сырой HTML из platforma35 (или текст с геопортала для legacy) |
| parsedFuels | String | JSON: `{comment, fuels: [{fuel, liters, cars}]}` |
| sourceCreatedAt | DateTime? | когда platforma35 создал запись |
| sourceUpdatedAt | DateTime? | когда platforma35 обновил запись |
| fetchedAt | DateTime | когда мы опросили |

### Setting (key-value)
Глобальные настройки и индикаторы состояния.

| Ключ | Значение |
|---|---|
| `default_points_seeded` | «1» (sentinel — coverage-точки сидились) |
| `lastRefreshAt` | ISO дата последнего успешного опроса |
| `lastRefreshSummary` | JSON `{stationsFound, stationsNew, stationsUpdated, errorsCount}` |
| `cookieStatus` | `alive` / `expired` (доступность platforma35) |
| `cookieStatusAt` | ISO дата последней проверки |
| `jsessionId` | (legacy, не используется после миграции на platforma35) |

### CoveragePoint (0 строк, legacy)
Точки покрытия для опроса геопортала. После миграции на platforma35
не используются — API отдаёт все АЗС одним запросом. Таблица оставлена
для совместимости со старым кодом.

## Ключевые файлы

### `src/lib/platforma35.ts`
Клиент публичного API platforma35.ru. Один метод `fetchAllStations()`,
который делает GET к `/communal_economy/azs/api/markers/` и возвращает
массив маркеров. Без авторизации.

### `src/lib/geoportal.ts`
Главная логика опроса:
- `refreshAllStations()` — полный цикл: получить → upsert → снапшоты → история
- `checkCookieStatus()` — лёгкий heartbeat для cron
- `parseFuelDetails()` — парсер текста (legacy, для перепарсинга старых данных)
- `processMarker()` — обработка одной АЗС (upsert + снапшот)
- `importHistoryFromPlatforma35()` — импорт встроенной истории

### `src/lib/db.ts`
Prisma Client singleton. Использует `globalThis` для предотвращения
множественных подключений в dev-режиме (Next.js hot reload).

### `src/lib/hooks.ts`
React hooks для фронтенда:
- `useStations()` — список АЗС с последним + предыдущим снапшотом
- `useStationHistory(stationId, hours)` — история по одной АЗС
- `useAnalytics(hours)` — агрегированные данные для графиков
- `useStats()` — агрегаты для stat-карт
- `useRefresh()` — обёртка над POST /api/refresh
- `useCoverage()` — CRUD coverage-точек (legacy)

### `src/app/page.tsx`
Единственная страница. ~1200 строк, содержит все компоненты:
- `HomePage` — главный компонент с табами
- `StatCard` — компактная stat-карта
- `StationCard` — карточка АЗС с цветной индикацией и трендами
- `TrendIcon` — стрелка ↑↓— с цветом и дельтой
- `StationHistoryDialog` — модальное окно с графиком по одной АЗС
- `AnalyticsPanel` — таб аналитики с 3 графиками
- `StationsPanel` — таб со списком АЗС + фильтрами
- `SettingsPanel` — таб с информацией об источнике + расписание cron

### `src/app/api/` — API Routes
- `stations/route.ts` — GET список АЗС (с previousSnapshot для трендов)
- `stations/[id]/history/route.ts` — GET история по одной АЗС
- `analytics/route.ts` — GET агрегаты для графиков
- `refresh/route.ts` — POST опрос platforma35
- `cookie-check/route.ts` — GET heartbeat
- `stats/route.ts` — GET агрегаты для stat-карт + cookieStatus
- `settings/route.ts` — GET/PUT настройки (legacy)
- `coverage/` — CRUD coverage-точек (legacy)

### `scripts/`
- `install.sh` — установка на голый Ubuntu 22.04
- `update.sh` — обновление кода (с `--force` для принудительной пересборки)
- `cron-refresh.sh` — обёртка для cron (cookie-check + refresh)
- `cleanup-duplicates.{ts,mjs}` — удалить дубли станций (после миграций)
- `reparse-snapshots.{ts,mjs}` — перепарсить старые снапшоты новым парсером
- `test-parser.{ts,mjs}` — тесты парсера (8 кейсов)

## История миграций

1. **Изначально** — опрос геопортала 3d-geoportal.vologda-city.ru
   через 9 coverage-точек с JSESSIONID. Работало, но кука протухала
   каждые 30 мин, приходилось вручную обновлять через настройки.

2. **Добавлены heartbeat + баннер** — cron каждые 5 мин проверял статус
   куки, в UI показывал зелёный/красный баннер.

3. **Миграция на platforma35.ru** — нашли публичный API, который отдаёт
   все 9 АЗС одним запросом без авторизации + координаты + логотипы +
   историю за день. Полностью отказались от геопортала.

4. **Чистка техдолга** — удалили 39 неиспользуемых shadcn-компонентов,
   46 мёртвых npm-зависимостей, мёртвый `tailwind.config.ts`,
   дублирующую toast-систему (radix-toast), legacy-код в `geoportal.ts`.

## Безопасность

- **Нет авторизации** — дашборд публичный. Если нужен доступ ограничить,
  можно добавить Basic Auth в Caddyfile или обернуть в ZeroTier-сеть.
- **JSESSIONID не используется** — данные идут из публичного API.
- **SQLite-файл** в `/var/www/vologda-azs/db/custom.db` — бэкапится
  ежедневно в 03:00, хранение 14 дней.
- **Caddy** использует Let's Encrypt для домена (для IP — HTTP-only).

## Производительность

- Один опрос platforma35 = 1 HTTP-запрос, ~0.5 сек
- Cron каждые 10 мин → ~144 опроса в сутки → ~600 снапшотов в БД
- Размер БД: ~10 МБ за 6 месяцев
- standalone-сборка: ~130 МБ (включая Prisma binaries)
- RAM приложения: ~40 МБ в простое
