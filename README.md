# АЗС Вологда — Мониторинг топлива

Дашборд наличия топлива на АЗС Вологды. Данные берёт из публичного API
[platforma35.ru](https://platforma35.ru/communal_economy/azs/) — без авторизации,
без капчи, без JSESSIONID.

## Возможности

- 📊 **9 АЗС** Вологды в одной сетке: 4 с топливом (зелёные), 5 без данных (серые)
- 🖼 **Логотипы брендов** (Лукойл, Газпромнефть) в каждой карточке
- 📍 **Координаты** каждой АЗС (широта/долгота от platforma35)
- 📈 **Стрелки трендов** по каждому типу топлива: ↑ растёт, ↓ падает, — стабильно
- 🚨 **Красная подсветка** для топлива с 0 литров (закончилось)
- 💾 **История остатков** в БД (SQLite) + графики по времени
- 🔄 **Автоопрос** каждые 10 минут через cron + heartbeat каждые 5 минут
- 📦 **Бэкап БД** ежедневно в 03:00, хранение 14 дней
- 📱 Адаптивный дизайн, доступ через ZeroTier или локальную сеть

## Технологии

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Backend:** Next.js API Routes
- **БД:** Prisma ORM + SQLite
- **Графики:** Recharts
- **Runtime:** Node.js 20 (продакшен) + bun (для запуска .ts скриптов)
- **Сборка:** `output: 'standalone'` (готово к PM2 + Caddy деплою)

## Структура БД

- `Station` — АЗС (9 шт). Поля: `externalId`, `brand`, `address`, `longitude`,
  `latitude`, `logoUrl`, `availabilityFuel`, `source`
- `FuelSnapshot` — снапшот остатков на момент опроса. Поля: `rawDetails`,
  `parsedFuels` (JSON с массивом топлив), `sourceUpdatedAt`, `fetchedAt`
- `Setting` — key-value настройки (lastRefreshAt, cookieStatus и т.п.)
- `CoveragePoint` — точки покрытия (legacy, не используются после перехода на platforma35)

## Быстрый старт (разработка)

```bash
# 1. Установить зависимости
bun install        # или pnpm install

# 2. Применить схему БД
bun run db:push

# 3. Запустить dev-сервер
bun run dev
```

Открыть http://localhost:3000

## Удобные команды

```bash
# Разработка
bun run dev                    # dev-сервер с hot reload
bun run lint                   # проверка ESLint
bun run build                  # production-сборка

# БД
bun run db:push                # применить схему Prisma к SQLite
bun run db:generate            # перегенерировать Prisma Client

# Утилиты (требуется bun)
bun run test:parser            # тесты парсера топлива (8 кейсов)
bun run reparse                # перепарсить все существующие снапшоты
bun run cleanup                # удалить дубликаты станций (после миграций)
```

## Деплой на продакшен (Ubuntu 22.04)

### Автоматическая установка (одна команда)

На чистом сервере Ubuntu 22.04:

```bash
# Клонируем репо во временную папку
sudo apt-get install -y git
git clone https://github.com/jinny21093/petrol.git /tmp/petrol

# Запускаем установку
# С доменом (HTTPS автоматически через Let's Encrypt):
sudo bash /tmp/petrol/scripts/install.sh azs.example.ru

# С IP-адресом (HTTP-only, для ZeroTier/локалки без домена):
sudo bash /tmp/petrol/scripts/install.sh 10.147.17.248
```

Скрипт сам поставит Node.js 20, pnpm, PM2, bun, Caddy, склонит репо в
`/var/www/vologda-azs`, соберёт приложение, запустит его, настроит HTTPS
(для домена) или HTTP (для IP), поставит cron-задачи.

Подробности — в [DEPLOY.md](./DEPLOY.md).

### Обновление кода на сервере

```bash
cd /var/www/vologda-azs
bash scripts/update.sh            # обычное обновление
bash scripts/update.sh --force    # принудительная пересборка
```

## Источник данных

**Endpoint:** `GET https://platforma35.ru/communal_economy/azs/api/markers/`

Возвращает JSON со всеми 9 АЗС Вологды:
- координаты (WGS84)
- логотипы брендов
- структурированные остатки по типам топлива (АИ-92, АИ-95, АИ-100)
- история за день (2-3 точки)
- комментарии о подвозе

Авторизация **не требуется**. Частота обновления на стороне platforma35 —
примерно раз в 2-3 часа. Cron дашборда опрашивает каждые 10 минут —
свежие данные подхватываются сразу, как только появляются.

## API

| Endpoint | Метод | Описание |
|---|---|---|
| `/api/stations` | GET | Список АЗС с последним снапшотом + предыдущим (для трендов) |
| `/api/stations/[id]/history` | GET | История остатков по конкретной АЗС. Параметр `?hours=N` (1-720) |
| `/api/analytics` | GET | Агрегированная аналитика по всем АЗС во времени |
| `/api/refresh` | POST | Опросить platforma35 (один запрос, все 9 АЗС) |
| `/api/cookie-check` | GET | Лёгкая проверка доступности platforma35 (heartbeat) |
| `/api/stats` | GET | Агрегированная статистика для дашборда |
| `/api/settings` | GET/PUT | Управление настройками (legacy) |
| `/api/coverage` | GET/POST | CRUD coverage-точек (legacy, не используется) |
| `/api/coverage/[id]` | PATCH/DELETE | CRUD coverage-точек (legacy) |

## Cron-задачи (на сервере)

| Расписание | Задача |
|---|---|
| `*/5 * * * *` | Heartbeat: GET /api/cookie-check (продление статуса) |
| `*/10 * * * *` | Полный опрос: bash scripts/cron-refresh.sh → POST /api/refresh |
| `0 3 * * *` | Бэкап БД: sqlite3 .backup, хранение 14 дней |

## Структура проекта

```
src/
├── app/
│   ├── api/                    # API routes (Next.js Route Handlers)
│   │   ├── analytics/          # агрегированная аналитика
│   │   ├── cookie-check/       # heartbeat
│   │   ├── coverage/           # CRUD coverage-точек (legacy)
│   │   ├── refresh/            # опрос platforma35
│   │   ├── settings/           # настройки (legacy)
│   │   ├── stations/           # список АЗС + история по конкретной
│   │   └── stats/              # агрегированная статистика
│   ├── layout.tsx              # корневой layout
│   ├── page.tsx                # главная страница (дашборд)
│   └── globals.css             # Tailwind CSS
├── components/ui/              # shadcn/ui (11 живых компонентов)
├── lib/
│   ├── db.ts                   # Prisma Client singleton
│   ├── geoportal.ts            # refreshAllStations + checkCookieStatus
│   ├── platforma35.ts          # клиент API platforma35.ru
│   ├── seed.ts                 # сидинг дефолтных coverage-точек
│   └── hooks.ts                # React hooks (useStations, useAnalytics и т.д.)
└── prisma/
    └── schema.prisma           # схема БД

scripts/
├── install.sh                  # установка на голый Ubuntu 22.04
├── update.sh                   # обновление кода на сервере (--force)
├── cron-refresh.sh             # обёртка для cron (cookie-check + refresh)
├── cleanup-duplicates.ts       # удаление дублей станций
├── reparse-snapshots.ts        # перепарсинг старых снапшотов
└── test-parser.ts              # тесты парсера топлива
```

## Лицензия

MIT — используйте как хотите.
