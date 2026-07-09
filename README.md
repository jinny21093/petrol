# АЗС Вологда — Мониторинг топлива

Дашборд наличия топлива на АЗС Вологды на данных геопортала
[3d-geoportal.vologda-city.ru](https://3d-geoportal.vologda-city.ru/portal/gasstation).

## Возможности

- 📊 Карточки АЗС с остатками по типам топлива (АИ-92, АИ-95 и т.д.)
- 🔄 Ручное и автоматическое обновление данных с геопортала
- 📍 Управление coverage-точками (добавление/отключение/удаление для масштабирования на новые районы)
- 🏷️ Фильтрация по бренду, статусу работы, поиск по адресу
- 💾 История остатков в БД (готовый фундамент для трендов и уведомлений)
- ⚙️ Настройка JSESSIONID через UI
- 📱 Адаптивный дизайн (mobile-first)

## Технологии

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Backend:** Next.js API Routes
- **БД:** Prisma ORM + SQLite
- **Сборка:** standalone output (готово к PM2 + Caddy деплою)

## Структура БД

- `CoveragePoint` — точки покрытия (9 дефолтных по Вологде)
- `Station` — АЗС с уникальным `externalId` (id с геопортала)
- `FuelSnapshot` — история остатков с timestamps
- `Setting` — key-value настройки (JSESSIONID и т.д.)

## Быстрый старт (разработка)

```bash
pnpm install
cp .env.example .env
pnpm prisma db push
pnpm prisma generate
pnpm dev
```

Открыть http://localhost:3000

## Деплой на продакшен (Ubuntu 22.04)

### Автоматическая установка (одна команда)

На чистом сервере Ubuntu 22.04:

```bash
# Клонируем репо во временную папку
sudo apt-get install -y git
git clone https://github.com/jinny21093/petrol.git /tmp/petrol

# Запускаем установку (замените домен на свой!)
sudo bash /tmp/petrol/scripts/install.sh azs.example.ru
```

Скрипт сам поставит Node.js 20, pnpm, PM2, Caddy, склонит репо в `/var/www/vologda-azs`,
соберёт приложение, запустит его, настроит HTTPS через Let's Encrypt и cron-автообновление.

После установки откройте `https://azs.example.ru`, зайдите в таб «Настройки» и вставьте JSESSIONID.

Подробности — в [DEPLOY.md](./DEPLOY.md).

### Обновление кода на сервере

Когда в репозитории появились новые коммиты (например, вы попросили ИИ добавить фичу
и он запушил в main):

```bash
cd /var/www/vologda-azs
bash scripts/update.sh
```

Скрипт сделает `git pull`, при необходимости обновит зависимости и схему БД, пересоберёт
Next.js и перезапустит приложение через PM2 с проверкой, что оно живо.

### Скрипты в репозитории

| Скрипт | Где запускать | Что делает |
|---|---|---|
| `scripts/install.sh` | На сервере (один раз) | Полная установка с нуля: Node + PM2 + Caddy + сборка + HTTPS + cron |
| `scripts/update.sh` | На сервере (при обновлениях) | `git pull` → `pnpm install` → `prisma db push` → `build` → `pm2 restart` с health-check |
| `scripts/cron-refresh.sh` | На сервере (через cron) | Лёгкий вызов `/api/refresh` через localhost (быстрее внешнего curl) |

## Важно про авторизацию

Геопортал Вологды требует ESIA-авторизацию (Госуслуги). Чтобы дашборд получал
реальные данные:

1. Откройте `https://3d-geoportal.vologda-city.ru/portal/gasstation` в браузере
2. Войдите через Госуслуги
3. DevTools → Application → Cookies → скопируйте `JSESSIONID`
4. Вставьте в таб «Настройки» дашборда

JSESSIONID периодически истекает — нужно обновлять вручную.

## API

| Endpoint | Метод | Описание |
|---|---|---|
| `/api/stations` | GET | Список АЗС с последним снапшотом. Фильтры: `?brand=`, `?status=`, `?includeHidden=` |
| `/api/coverage` | GET | Список coverage-точек |
| `/api/coverage` | POST | Создать coverage-точку `{name, mapX, mapY, scale?}` |
| `/api/coverage/[id]` | PATCH | Обновить точку |
| `/api/coverage/[id]` | DELETE | Удалить точку |
| `/api/refresh` | POST | Опросить геопортал по всем активным точкам |
| `/api/settings` | GET | Получить настройки (JSESSIONID маскируется) |
| `/api/settings` | PUT | Сохранить `{jsessionId}` |
| `/api/stats` | GET | Агрегированная статистика для дашборда |

## Лицензия

MIT — используйте как хотите.
