#!/usr/bin/env bash
#
# install.sh — автоматическая установка дашборда АЗС Вологды на чистой Ubuntu 22.04
#
# Запуск (с sudo):
#   sudo bash install.sh <DOMAIN> [REPO_URL] [INSTALL_DIR]
#
# Пример:
#   sudo bash install.sh azs.example.ru
#   sudo bash install.sh azs.example.ru https://github.com/jinny21093/petrol.git /var/www/vologda-azs
#
# Что делает:
#   1. Ставит Node.js 20 LTS, pnpm, PM2, Caddy, git, sqlite3
#   2. Клонирует репо в INSTALL_DIR (по умолчанию /var/www/vologda-azs)
#   3. Создаёт .env с абсолютным путём к SQLite
#   4. Заливает схему БД
#   5. Собирает Next.js standalone
#   6. Регистрирует приложение в PM2 + автозапуск через systemd
#   7. Генерирует Caddyfile под ваш домен + перезагружает Caddy (авто-HTTPS)
#   8. Ставит cron-задачу автообновления каждые 10 минут
#   9. Создаёт папку бэкапов + cron-бэкап БД на 14 дней
#
# После успешной установки откройте https://<DOMAIN> в браузере.
# JSESSIONID нужно будет вставить вручную через таб «Настройки».
#

set -euo pipefail

# -------- Цвета для логов --------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

# -------- Проверка аргументов --------
if [[ $# -lt 1 ]]; then
    err "Использование: sudo bash install.sh <DOMAIN> [REPO_URL] [INSTALL_DIR]"
    err "Пример: sudo bash install.sh azs.example.ru"
    exit 1
fi

DOMAIN="$1"
REPO_URL="${2:-https://github.com/jinny21093/petrol.git}"
INSTALL_DIR="${3:-/var/www/vologda-azs}"
APP_NAME="vologda-azs"
NODE_MAJOR=20
REFRESH_INTERVAL_MIN="${REFRESH_INTERVAL_MIN:-10}"

# Проверка рута
if [[ $EUID -ne 0 ]]; then
    err "Скрипт нужно запускать с sudo: sudo bash install.sh ..."
    exit 1
fi

# Определяем пользователя-владельца (не root, чтобы потом не было проблем с правами на БД)
RUN_USER="${SUDO_USER:-$USER}"
if [[ "$RUN_USER" == "root" ]]; then
    warn "Запущено от root напрямую. Рекомендуется использовать sudo от обычного пользователя."
    warn "Продолжаю с RUN_USER=root."
fi

log "Конфигурация установки:"
log "  • Домен:        $DOMAIN"
log "  • Репо:         $REPO_URL"
log "  • Папка:        $INSTALL_DIR"
log "  • Пользователь: $RUN_USER"
log "  • App name:     $APP_NAME"
log ""

# -------- 1. Установка системных пакетов --------
log "Шаг 1/9: установка системных пакетов (Node.js $NODE_MAJOR, git, sqlite3, build-essential)..."

# NodeSource
if ! command -v node &> /dev/null || [[ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)" != "$NODE_MAJOR" ]]; then
    log "  Устанавливаю Node.js $NODE_MAJOR LTS..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
else
    ok "  Node.js уже установлен: $(node -v)"
fi

apt-get install -y git sqlite3 build-essential

# pnpm и PM2
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm
fi
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

ok "  Node.js: $(node -v), pnpm: $(pnpm -v), PM2: $(pm2 -v), sqlite3: $(sqlite3 --version | head -1)"

# -------- 2. Установка Caddy --------
log "Шаг 2/9: установка Caddy..."

if ! command -v caddy &> /dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    apt-get update
    apt-get install -y caddy
else
    ok "  Caddy уже установлен: $(caddy version 2>&1 | head -1)"
fi

# -------- 3. Клонирование репо --------
log "Шаг 3/9: клонирование репо в $INSTALL_DIR..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "  Папка уже существует, делаю git pull..."
    chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    sudo -u "$RUN_USER" git pull || warn "  git pull не удался, продолжаю с существующим кодом"
else
    # Создаём родительскую папку (например /var/www) и сразу отдаём её пользователю,
    # чтобы git clone от имени $RUN_USER мог создать $INSTALL_DIR внутри.
    mkdir -p "$(dirname "$INSTALL_DIR")"
    chown "$RUN_USER":"$RUN_USER" "$(dirname "$INSTALL_DIR")"
    sudo -u "$RUN_USER" git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

ok "  Код в $INSTALL_DIR"

# Передаём владение пользователем (на случай повторного запуска)
chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"

# -------- 4. Установка зависимостей + .env --------
log "Шаг 4/9: установка зависимостей и создание .env..."

cd "$INSTALL_DIR"
sudo -u "$RUN_USER" pnpm install

# Создаём .env если нет
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cat > "$INSTALL_DIR/.env" <<EOF
DATABASE_URL="file:$INSTALL_DIR/db/custom.db"
NODE_ENV="production"
PORT=3000
EOF
    ok "  .env создан"
else
    ok "  .env уже существует, не перезаписываю"
fi
chown "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/.env"

# -------- 5. Инициализация БД --------
log "Шаг 5/9: инициализация БД (prisma db push)..."

cd "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/db"
chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/db"

sudo -u "$RUN_USER" pnpm prisma db push
sudo -u "$RUN_USER" pnpm prisma generate
ok "  БД готова: $INSTALL_DIR/db/custom.db"

# -------- 6. Сборка Next.js --------
log "Шаг 6/9: сборка Next.js (output: standalone)..."

cd "$INSTALL_DIR"
# Копируем public/ и .next/static в standalone (требуется для standalone-сервера)
sudo -u "$RUN_USER" pnpm build

# Next.js standalone требует, чтобы public/ лежал рядом с server.js
if [[ -d "$INSTALL_DIR/public" ]]; then
    cp -r "$INSTALL_DIR/public" "$INSTALL_DIR/.next/standalone/public"
fi
if [[ -d "$INSTALL_DIR/.next/static" ]]; then
    mkdir -p "$INSTALL_DIR/.next/standalone/.next"
    cp -r "$INSTALL_DIR/.next/static" "$INSTALL_DIR/.next/standalone/.next/static"
fi
chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR/.next/standalone"

ok "  Сборка готова: $INSTALL_DIR/.next/standalone/server.js"

# -------- 7. Настройка PM2 --------
log "Шаг 7/9: настройка PM2..."

# Папка для логов
mkdir -p /var/log/vologda-azs
chown "$RUN_USER":"$RUN_USER" /var/log/vologda-azs

# Останавливаем старый процесс если был
sudo -u "$RUN_USER" pm2 delete "$APP_NAME" 2>/dev/null || true

# Запускаем через ecosystem.config.js
cd "$INSTALL_DIR"
sudo -u "$RUN_USER" pm2 start ecosystem.config.js
sudo -u "$RUN_USER" pm2 save

# Автозапуск через systemd
log "  Регистрирую PM2 в systemd для автозапуска..."
PM2_STARTUP_OUTPUT=$(sudo -u "$RUN_USER" pm2 startup systemd -u "$RUN_USER" --hp "/home/$RUN_USER" 2>&1 || true)
PM2_STARTUP_CMD=$(echo "$PM2_STARTUP_OUTPUT" | grep -oE 'sudo env PATH=[^ ]+ /[^ ]+pm2[^ ]+ startup [^ ]+ -u [^ ]+ --hp [^ ]+' | head -1)
if [[ -n "$PM2_STARTUP_CMD" ]]; then
    eval "$PM2_STARTUP_CMD" || warn "  Не удалось зарегистрировать PM2 в systemd (возможно уже зарегистрирован)"
    ok "  PM2 автозапуск настроен"
else
    warn "  Не удалось автоматически настроить автозапуск PM2."
    warn "  Выполните вручную: sudo -u $RUN_USER pm2 startup systemd"
fi

ok "  Приложение запущено: http://127.0.0.1:3000"

# -------- 8. Настройка Caddy (HTTPS) --------
log "Шаг 8/9: настройка Caddy для домена $DOMAIN (авто-HTTPS)..."

# Бэкап старого Caddyfile
if [[ -f /etc/caddy/Caddyfile ]]; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
fi

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip zstd

    # Статика Next.js
    @static path /_next/static/*
    handle @static {
        root * $INSTALL_DIR/.next/standalone
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    # public/
    @public path /favicon.ico /robots.txt /logo.svg
    handle @public {
        root * $INSTALL_DIR/.next/standalone
        file_server
    }

    # Проксирование на Next.js
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    log {
        output file /var/log/caddy/vologda-azs.log {
            roll_size 10MB
            roll_keep 5
        }
        format json
    }
}
EOF

systemctl reload caddy || systemctl restart caddy
ok "  Caddy настроен, HTTPS сертификат будет получен автоматически"
ok "  Сайт будет доступен на https://$DOMAIN (через 30-60 сек после получения сертификата)"

# -------- 9. Cron: автообновление + бэкапы --------
log "Шаг 9/9: настройка cron (автообновление каждые $REFRESH_INTERVAL_MIN мин + бэкап БД)..."

# Папка бэкапов
mkdir -p /var/backups/vologda-azs
chown "$RUN_USER":"$RUN_USER" /var/backups/vologda-azs

# Cron-задачи для пользователя RUN_USER
CRON_MARK_BEGIN="# >>> vologda-azs begin >>>"
CRON_MARK_END="# <<< vologda-azs end <<<"

# Удаляем старый блок между метками
( crontab -u "$RUN_USER" -l 2>/dev/null | sed "/$CRON_MARK_BEGIN/,/$CRON_MARK_END/d" ; \
  echo "$CRON_MARK_BEGIN" ; \
  echo "*/$REFRESH_INTERVAL_MIN * * * * bash $INSTALL_DIR/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1 || true" ; \
  echo "0 3 * * * sqlite3 $INSTALL_DIR/db/custom.db \".backup '/var/backups/vologda-azs/\$(date +\\%F).db'\" && find /var/backups/vologda-azs -mtime +14 -delete > /dev/null 2>&1 || true" ; \
  echo "$CRON_MARK_END" \
) | crontab -u "$RUN_USER" -

ok "  Cron настроен (обновление каждые $REFRESH_INTERVAL_MIN мин, бэкап БД в 03:00 ежедневно)"

# -------- Финальный отчёт --------
echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  УСТАНОВКА ЗАВЕРШЕНА${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "  🌐 Сайт:        https://$DOMAIN"
echo "  📁 Папка:       $INSTALL_DIR"
echo "  🗄  БД:          $INSTALL_DIR/db/custom.db"
echo "  👤 Пользователь: $RUN_USER"
echo ""
echo "  Следующие шаги:"
echo "    1. Откройте https://$DOMAIN в браузере"
echo "       (если не работает — подождите 1-2 мин, пока Caddy получит сертификат)"
echo "    2. Перейдите в таб «Настройки»"
echo "    3. Вставьте JSESSIONID (как его получить — см. README.md)"
echo "    4. Перейдите в таб «АЗС», нажмите «Обновить»"
echo ""
echo "  Полезные команды:"
echo "    pm2 status                      — статус приложения"
echo "    pm2 logs $APP_NAME              — живые логи"
echo "    sudo journalctl -u caddy -f     — логи Caddy"
echo "    sudo systemctl reload caddy     — применить новый Caddyfile"
echo ""
echo "  Обновление кода:"
echo "    cd $INSTALL_DIR && bash scripts/update.sh"
echo ""
warn "  ⚠ Если домен за Cloudflare — отключите проксирование (серое облако)"
warn "    для этого поддомена, иначе Caddy не сможет получить HTTPS сертификат."
echo ""
