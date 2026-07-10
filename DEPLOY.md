# Деплой дашборда АЗС Вологды на Ubuntu 22.04

Полный план разворачивания на чистом сервере. Время: ~30 минут.

## Системные требования

- Ubuntu 22.04 LTS (чистая установка)
- 1 vCPU, 1 ГБ RAM, 10 ГБ диска (минимум)
- Домен с A-записью на IP вашего сервера
- Открытые порты 80 и 443

---

## Этап 1. Установка Node.js 20 LTS + pnpm + PM2

```bash
# Node.js 20 LTS через NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential

# pnpm и PM2 глобально
sudo npm install -g pnpm pm2

# Проверка
node -v   # v20.x.x
pnpm -v
pm2 -v
```

## Этап 2. Установка Caddy (reverse proxy + HTTPS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## Этап 3. Клонирование и сборка проекта

```bash
# Папка под приложение
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www

git clone https://github.com/jinny21093/petrol.git vologda-azs
cd vologda-azs

# Установка зависимостей
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

После сборки появится `.next/standalone/` — это автономный Node.js-сервер со всеми зависимостями внутри.

## Этап 4. Запуск через PM2

```bash
# Папка под логи
sudo mkdir -p /var/log/vologda-azs
sudo chown $USER:$USER /var/log/vologda-azs

# Запуск
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

В этот момент приложение слушает на `127.0.0.1:3000`.

## Этап 5. Настройка Caddy (HTTPS + домен)

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

### Если домен за Cloudflare

Если в Cloudflare proxy включено (оранжевое облако), Caddy не сможет пройти HTTP-01 challenge. Решения:
- **Проще:** отключить проксирование Cloudflare для этого поддомена (серое облако — DNS only)
- **Сложнее:** настроить DNS-01 challenge через Cloudflare API token

## Этап 6. Первичная настройка дашборда

1. Откройте `https://ваш-домен` в браузере
2. Перейдите в таб **«Настройки»**
3. **Как получить JSESSIONID:**
   - Откройте `https://3d-geoportal.vologda-city.ru/portal/gasstation` в браузере
   - Войдите через Госуслуги (ESIA)
   - Откройте DevTools (F12) → Application → Cookies → `https://3d-geoportal.vologda-city.ru`
   - Скопируйте значение `JSESSIONID`
4. Вставьте значение в поле «Новый JSESSIONID» и нажмите «Сохранить»
5. Перейдите в таб **«АЗС»**, нажмите **«Обновить»** — должны подтянуться станции

## Этап 7. Автообновление данных (опционально)

Cron-задача, которая раз в 10 минут дёргает `/api/refresh`:

```bash
crontab -e
```

Добавьте строку (замените домен):

```cron
*/10 * * * * curl -s -X POST https://ваш-домен/api/refresh > /dev/null 2>&1
```

## Этап 8. Бэкапы БД

SQLite — это просто файл. Бэкап раз в сутки с хранением 14 дней:

```cron
0 3 * * * sqlite3 /var/www/vologda-azs/db/custom.db ".backup '/var/backups/vologda-azs/$(date +\%F).db'" && find /var/backups/vologda-azs -mtime +14 -delete
```

Перед первой установкой создайте папку:

```bash
sudo mkdir -p /var/backups/vologda-azs
sudo chown $USER:$USER /var/backups/vologda-azs
```

---

## Обновление кода после деплоя

```bash
cd /var/www/vologda-azs
git pull
pnpm install
pnpm prisma db push        # если менялась схема БД
pnpm prisma generate
pnpm build
pm2 restart vologda-azs
```

## Полезные команды эксплуатации

```bash
pm2 logs vologda-azs             # живые логи
pm2 logs vologda-azs --lines 100 # последние 100 строк
pm2 restart vologda-azs          # рестарт
pm2 reload vologda-azs           # zero-downtime reload
pm2 monit                        # интерактивный мониторинг
pm2 status                       # статус всех процессов

sudo journalctl -u caddy -f      # логи Caddy
sudo systemctl reload caddy      # применить новый Caddyfile
```

## Возможные проблемы

### 401/403 при обновлении данных
JSESSIONID умер (геопортал разлогинил сессию). Вставьте новый через таб «Настройки».

### 502 Bad Gateway
Next.js не отвечает на :3000. Проверьте:
```bash
pm2 status                     # приложение должно быть online
pm2 logs vologda-azs --lines 50
curl -I http://127.0.0.1:3000  # должно вернуть 200
```

### Prisma ошибка «database is locked»
SQLite не выносит параллельные записи. PM2 запущен с `instances: 1` — это правильно. Если ошибка появляется — проверьте, что в `ecosystem.config.js` именно 1 инстанс.

### Caddy не может получить сертификат
Проверьте:
1. A-запись домена указывает на ваш сервер: `dig ваш-домен +short`
2. Порт 80 открыт в файрволе: `sudo ufw status`
3. Если Cloudflare — отключите проксирование (серое облако)

### Права на БД
Если Next.js запущен от `root` через PM2 startup, а файл БД принадлежит другому пользователю — будут ошибки записи. Решение:
```bash
sudo chown -R $USER:$USER /var/www/vologda-azs/db
```
Или запускайте PM2 под тем же пользователем, который владеет папкой.
