# Деплой дашборда АЗС Вологды на Ubuntu 22.04

Полный план разворачивания на чистом сервере. Время: ~5 минут через
`install.sh`, ~30 минут вручную.

## Системные требования

- Ubuntu 22.04 LTS (чистая установка)
- 1 vCPU, 1 ГБ RAM, 10 ГБ диска (минимум)
- Для HTTPS: домен с A-записью на IP вашего сервера, открытые порты 80 и 443
- Для HTTP-only: достаточно быть в одной ZeroTier-сети с сервером (или иметь LAN-доступ)

---

## Вариант A — Автоматическая установка (рекомендуется)

На чистом сервере Ubuntu 22.04:

```bash
# Установить git
sudo apt-get install -y git

# Клонировать репо во временную папку
git clone https://github.com/jinny21093/petrol.git /tmp/petrol

# Запустить установку (замените аргумент на ваш домен или IP)
sudo bash /tmp/petrol/scripts/install.sh azs.example.ru
# или для ZeroTier/локалки без домена:
sudo bash /tmp/petrol/scripts/install.sh 10.147.17.248
```

Скрипт сам:
1. Установит Node.js 20, pnpm, PM2, bun, Caddy, git, sqlite3, cron
2. Склонирует репо в `/var/www/vologda-azs`
3. Применит схему БД и сгенерирует Prisma Client
4. Соберёт Next.js standalone
5. Запустит приложение в PM2 + настроит автозапуск через systemd
6. Настроит Caddy (HTTPS для домена / HTTP-only для IP)
7. Поставит cron-задачи (heartbeat, опрос, бэкапы)

**После установки:**
- Для домена: откройте `https://ваш-домен` — данные появятся сразу
- Для IP: откройте `http://ваш-ip` — данные появятся сразу

**JSESSIONID больше не нужен** — данные идут из публичного API platforma35.ru
без авторизации.

---

## Вариант B — Ручная установка (поэтапно)

### Этап 1. Установка Node.js 20 + pnpm + PM2 + bun

```bash
# Node.js 20 LTS через NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential sqlite3 cron

# Глобальные утилиты
sudo npm install -g pnpm pm2 bun

# Проверка
node -v     # v20.x.x
pnpm -v
pm2 -v
bun --version
```

### Этап 2. Установка Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### Этап 3. Клонирование и сборка проекта

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www

git clone https://github.com/jinny21093/petrol.git vologda-azs
cd vologda-azs

# Установка зависимостей (теперь ~480 пакетов вместо ~915 после чистки)
pnpm install

# Конфигурация окружения
cp .env.example .env
# Отредактируйте .env — укажите абсолютный путь к БД:
#   DATABASE_URL="file:/var/www/vologda-azs/db/custom.db"
nano .env

# Создание БД и генерация Prisma-клиента
pnpm prisma db push
pnpm prisma generate

# Сборка Next.js (output: 'standalone')
pnpm build
```

После сборки появится `.next/standalone/` — это автономный Node.js-сервер
со всеми зависимостями внутри.

### Этап 4. Запуск через PM2

```bash
# Папка под логи
sudo mkdir -p /var/log/vologda-azs
sudo chown $USER:$USER /var/log/vologda-azs

# Запуск через ecosystem.config.js
pm2 start ecosystem.config.js

# Проверка
pm2 status
pm2 logs vologda-azs --lines 20

# Сохранить список процессов для автозапуска
pm2 save
pm2 startup systemd
# PM2 выведет команду вида:
#   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup ...
# Скопируйте её и выполните с sudo
```

Приложение слушает на `127.0.0.1:3000`.

### Этап 5. Настройка Caddy

#### Для домена (HTTPS автоматически через Let's Encrypt):

```bash
# Отредактируйте Caddyfile — замените azs.example.ru на ваш домен
nano Caddyfile

# Скопируйте в системную папку Caddy
sudo cp Caddyfile /etc/caddy/Caddyfile

# Перезагрузите Caddy — он автоматически получит Let's Encrypt сертификат
sudo systemctl reload caddy
sudo systemctl status caddy
```

Через 30-60 секунд сайт будет доступен на `https://ваш-домен`.

#### Для IP-адреса (HTTP-only, ZeroTier/локалка без домена):

Создайте `/etc/caddy/Caddyfile` с содержимым:

```caddy
:80 {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
    log {
        output file /var/log/caddy/vologda-azs.log {
            roll_size 10MB
            roll_keep 5
        }
        format json
    }
}
```

Примените:
```bash
sudo systemctl reload caddy
```

Сайт будет доступен на `http://ваш-ip` (без HTTPS).

#### Если домен за Cloudflare

Если в Cloudflare proxy включено (оранжевое облако), Caddy не сможет
пройти HTTP-01 challenge. Решения:
- **Проще:** отключить проксирование Cloudflare для этого поддомена
  (серое облако — DNS only)
- **Сложнее:** настроить DNS-01 challenge через Cloudflare API token

### Этап 6. Настройка cron

```bash
# Создать папки
sudo mkdir -p /var/log/vologda-azs /var/backups/vologda-azs
sudo chown $USER:$USER /var/log/vologda-azs /var/backups/vologda-azs

# Открыть crontab текущего пользователя
crontab -e
```

Вставьте 3 строки:

```cron
# vologda-azs
*/5 * * * * curl -fsS -m 10 -X GET http://127.0.0.1:3000/api/cookie-check > /dev/null 2>&1 || true
*/10 * * * * bash /var/www/vologda-azs/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1 || true
0 3 * * * sqlite3 /var/www/vologda-azs/db/custom.db ".backup '/var/backups/vologda-azs/$(date +\%F).db'" && find /var/backups/vologda-azs -mtime +14 -delete > /dev/null 2>&1 || true
```

---

## После установки — что делать

**Ничего особенного не нужно.** Данные начинают подтягиваться сразу —
cron каждые 10 минут дёргает `/api/refresh`, который получает все 9 АЗС
с platforma35.ru одним запросом.

Откройте дашборд в браузере и нажмите «Обновить данные» в шапке для
моментального первого опроса (не ждите 10 минут).

---

## Обновление кода после деплоя

```bash
cd /var/www/vologda-azs
bash scripts/update.sh             # обычное обновление
bash scripts/update.sh --force     # принудительная пересборка (если прошлый запуск упал)
```

Скрипт сам:
1. `git pull` (с авто-откатом pnpm-файлов)
2. `pnpm install` (если package.json менялся)
3. `prisma db push` (если схема менялась) + `prisma generate`
4. Перепарсинг снапшотов + cleanup дубликатов
5. `pnpm build`
6. `pm2 restart vologda-azs`
7. Health check (curl http://127.0.0.1:3000/)
8. Обновление cron-задач

## Полезные команды эксплуатации

```bash
# Логи
pm2 logs vologda-azs             # живые логи приложения
pm2 logs vologda-azs --lines 100 # последние 100 строк
sudo tail -f /var/log/vologda-azs/cron.log  # логи cron-задач
sudo journalctl -u caddy -f      # логи Caddy

# Управление PM2
pm2 status                       # статус всех процессов
pm2 restart vologda-azs          # ручной рестарт
pm2 monit                        # интерактивный мониторинг

# Caddy
sudo systemctl reload caddy      # применить новый Caddyfile
sudo systemctl status caddy      # статус

# БД
sqlite3 /var/www/vologda-azs/db/custom.db   # интерактивный SQL-клиент
ls -la /var/backups/vologda-azs/            # список бэкапов

# Cron
crontab -l                       # список задач текущего пользователя
sudo tail -f /var/log/syslog | grep CRON   # логи запусков cron
```

## Возможные проблемы

### 502 Bad Gateway
Next.js не отвечает на :3000. Проверьте:
```bash
pm2 status                     # приложение должно быть online
pm2 logs vologda-azs --lines 50
curl -I http://127.0.0.1:3000  # должно вернуть 200
```

### Prisma ошибка «database is locked»
SQLite не выносит параллельные записи. PM2 запущен с `instances: 1` —
это правильно. Если ошибка появляется — проверьте, что в
`ecosystem.config.js` именно 1 инстанс.

### Caddy не может получить сертификат (для домена)
Проверьте:
1. A-запись домена указывает на ваш сервер: `dig ваш-домен +short`
2. Порт 80 открыт в файрволе: `sudo ufw status`
3. Если Cloudflare — отключите проксирование (серое облако)

### Права на БД
Если Next.js запущен от `root` через PM2 startup, а файл БД принадлежит
другому пользователю — будут ошибки записи. Решение:
```bash
sudo chown -R $USER:$USER /var/www/vologda-azs/db
```
Или запускайте PM2 под тем же пользователем, который владеет папкой.

### Сайт открывается, но данные АЗС не обновляются
Проверьте доступность platforma35.ru:
```bash
curl -I https://platforma35.ru/communal_economy/azs/api/markers/
# Должно быть HTTP/1.1 200 OK

# Если не отвечает — проблема в сети/VPN. Сам API публичный, без авторизации.
```

### update.sh падает
Скрипт переписан без `set -e`, поэтому должен быть устойчивым. Если всё-таки
упал — смотрите на какой шаг:
```bash
bash scripts/update.sh --force 2>&1 | tee /tmp/update.log
```
Скиньте `/tmp/update.log` — разберёмся.
