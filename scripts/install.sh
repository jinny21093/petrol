#!/usr/bin/env bash
#
# install.sh — автоматическая установка дашборда АЗС Вологды на чистой Ubuntu 22.04
#
# Запуск (с sudo):
#   sudo bash install.sh <DOMAIN_OR_IP> [REPO_URL] [INSTALL_DIR]
#
# Примеры:
#   # С доменом (HTTPS автоматически через Let's Encrypt):
#   sudo bash install.sh azs.example.ru
#
#   # С IP-адресом (HTTP-only, без HTTPS — для локалки/ZeroTier):
#   sudo bash install.sh 10.147.17.248
#
#   # Явно отключить HTTPS, даже если передан домен:
#   sudo bash install.sh my-server.local --no-https
#
#   # Свой репо и папка установки:
#   sudo bash install.sh 10.147.17.248 https://github.com/jinny21093/petrol.git /var/www/vologda-azs
#
# Что делает:
#   1. Ставит Node.js 20 LTS, pnpm, PM2, Caddy, git, sqlite3, cron
#   2. Клонирует репо в INSTALL_DIR (по умолчанию /var/www/vologda-azs)
#   3. Создаёт .env с абсолютным путём к SQLite
#   4. Заливает схему БД
#   5. Собирает Next.js standalone
#   6. Регистрирует приложение в PM2 + автозапуск через systemd
#   7. Генерирует Caddyfile:
#      • если DOMAIN это IP — режим HTTP-only на порту 80 (без HTTPS)
#      • если DOMAIN это домен — режим HTTPS с авто-сертификатом Let's Encrypt
#   8. Открывает порт 80 в ufw и разрешает ZeroTier-интерфейсы (в режиме IP)
#   9. Ставит cron-задачу автообновления каждые 10 минут
#  10. Создаёт папку бэкапов + cron-бэкап БД на 14 дней
#
# После успешной установки откройте http(s)://<DOMAIN_OR_IP> в браузере.
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
    err "Использование: sudo bash install.sh <DOMAIN_OR_IP> [REPO_URL] [INSTALL_DIR] [--no-https]"
    err "Пример: sudo bash install.sh 10.147.17.248"
    err "        sudo bash install.sh azs.example.ru"
    exit 1
fi

DOMAIN="$1"
APP_NAME="vologda-azs"
NODE_MAJOR=20
REFRESH_INTERVAL_MIN="${REFRESH_INTERVAL_MIN:-10}"

# Парсим остальные аргументы — ищем REPO_URL, INSTALL_DIR и флаг --no-https
FORCE_NO_HTTPS=false
REPO_URL="https://github.com/jinny21093/petrol.git"
INSTALL_DIR="/var/www/vologda-azs"
POSITIONAL_ARGS=()
for arg in "${@:2}"; do
    case "$arg" in
        --no-https)
            FORCE_NO_HTTPS=true
            ;;
        --*)
            warn "Неизвестный флаг: $arg (игнорируется)"
            ;;
        *)
            POSITIONAL_ARGS+=("$arg")
            ;;
    esac
done
if [[ ${#POSITIONAL_ARGS[@]} -ge 1 ]]; then
    REPO_URL="${POSITIONAL_ARGS[0]}"
fi
if [[ ${#POSITIONAL_ARGS[@]} -ge 2 ]]; then
    INSTALL_DIR="${POSITIONAL_ARGS[1]}"
fi

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

apt-get install -y git sqlite3 build-essential cron

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
# ВАЖНО: grep может ничего не найти → exit 1 → с set -e это убьёт скрипт.
# Поэтому добавляем `|| true` к pipeline, чтобы он не падал.
PM2_STARTUP_CMD=$( { echo "$PM2_STARTUP_OUTPUT" | grep -oE 'sudo env PATH=[^ ]+ /[^ ]+pm2[^ ]+ startup [^ ]+ -u [^ ]+ --hp [^ ]+' | head -1; } || true )
if [[ -n "$PM2_STARTUP_CMD" ]]; then
    eval "$PM2_STARTUP_CMD" || warn "  Не удалось зарегистрировать PM2 в systemd (возможно уже зарегистрирован)"
    ok "  PM2 автозапуск настроен"
else
    warn "  Не удалось автоматически настроить автозапуск PM2."
    warn "  Выполните вручную для автозапуска при ребуте сервера:"
    warn "    sudo -u $RUN_USER pm2 startup systemd"
    warn "  (и выполните команду, которую выведет PM2)"
fi

ok "  Приложение запущено: http://127.0.0.1:3000"

# -------- 8. Настройка Caddy --------
log "Шаг 8/9: настройка Caddy для $DOMAIN..."

# Бэкап старого Caddyfile
if [[ -f /etc/caddy/Caddyfile ]]; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
fi

# Детектим, что $DOMAIN — это IP-адрес (IPv4 или IPv6).
# Если да — переводим Caddy в режим HTTP-only (без HTTPS), слушаем 0.0.0.0:80.
# Это типовой сценарий для локальных/ZeroTier-инсталляций без домена.
IS_IP=false
if [[ "$DOMAIN" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || [[ "$DOMAIN" =~ ^\[?[0-9a-fA-F:]+\]?$ ]]; then
    IS_IP=true
fi

# Явный флаг --no-https форсирует HTTP-only режим даже для домена
if [[ "$FORCE_NO_HTTPS" == "true" ]]; then
    IS_IP=true
fi

if [[ "$IS_IP" == "true" ]]; then
    log "  Режим: HTTP-only (без HTTPS) — $DOMAIN выглядит как IP-адрес или передан --no-https"
    cat > /etc/caddy/Caddyfile <<EOF
# HTTP-only режим. Слушаем 80 порт на всех интерфейсах.
# HTTPS НЕ запрашивается (нет домена → нет Let's Encrypt).
# Используем ':80' (без префикса http:// и без IP), чтобы Caddy матчил
# ЛЮБОЙ Host header — иначе запросы с Host: 10.147.17.248 будут падать
# в дефолтный 404/пустой ответ.
#
# ВАЖНО: вся статики проксируется на Next.js (127.0.0.1:3000), потому что
# Next.js standalone сам умеет отдавать /.next/static/* и /public/*
# с правильными MIME-типами и Cache-Control. Раньше мы пытались отдавать
# статику через Caddy file_server, но пути не сходились (на диске .next/static,
# в URL /_next/static — разница в точке), и Caddy возвращал 404 → CSS/JS не
# грузились → сайт отображался без стилей.
:80 {
    encode gzip zstd

    # Всё проксируем на Next.js — он сам отдаёт HTML, CSS, JS, шрифты, иконки
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
EOF
    SITE_URL="http://$DOMAIN"
else
    log "  Режим: HTTPS (домен $DOMAIN, авто-сертификат Let's Encrypt)"
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip zstd

    # Всё проксируем на Next.js (см. комментарий в IP-режиме выше)
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
EOF
    SITE_URL="https://$DOMAIN"
fi

systemctl reload caddy || systemctl restart caddy
ok "  Caddy настроен"
ok "  Сайт будет доступен на $SITE_URL"

# Если HTTP-only — открыть порт 80 в ufw (если он включён)
if [[ "$IS_IP" == "true" ]]; then
    if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
        log "  Открываю порт 80 в ufw..."
        ufw allow 80/tcp || true
        # Разрешаем трафик с интерфейсов ZeroTier
        ufw allow in on zt+ comment 'ZeroTier' || true
        ok "  ufw: порт 80 и ZeroTier интерфейсы открыты"
    fi
fi

# -------- 9. Cron: автообновление + бэкапы --------
log "Шаг 9/9: настройка cron (автообновление каждые $REFRESH_INTERVAL_MIN мин + бэкап БД)..."

# Проверяем, что crontab доступен
if ! command -v crontab &> /dev/null; then
    warn "  crontab не найден. Устанавливаю пакет cron..."
    apt-get install -y cron
    systemctl enable cron || true
    systemctl start cron || true
fi

if ! command -v crontab &> /dev/null; then
    err "  Не удалось установить crontab. Cron-задачи не настроены."
    err "  Установите вручную: sudo apt install -y cron"
    err "  Затем перезапустите этот скрипт."
else
    ok "  crontab доступен: $(which crontab)"
fi

# Папка бэкапов
mkdir -p /var/backups/vologda-azs
chown "$RUN_USER":"$RUN_USER" /var/backups/vologda-azs

# Cron-задачи для пользователя RUN_USER
CRON_MARK_BEGIN="# >>> vologda-azs begin >>>"
CRON_MARK_END="# <<< vologda-azs end <<<"

if command -v crontab &> /dev/null; then
    # Удаляем старый блок между метками и добавляем новый
    ( crontab -u "$RUN_USER" -l 2>/dev/null | sed "/$CRON_MARK_BEGIN/,/$CRON_MARK_END/d" ; \
      echo "$CRON_MARK_BEGIN" ; \
      echo "*/$REFRESH_INTERVAL_MIN * * * * bash $INSTALL_DIR/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1 || true" ; \
      echo "0 3 * * * sqlite3 $INSTALL_DIR/db/custom.db \".backup '/var/backups/vologda-azs/\$(date +\\%F).db'\" && find /var/backups/vologda-azs -mtime +14 -delete > /dev/null 2>&1 || true" ; \
      echo "$CRON_MARK_END" \
    ) | crontab -u "$RUN_USER" -
    ok "  Cron настроен (обновление каждые $REFRESH_INTERVAL_MIN мин, бэкап БД в 03:00 ежедневно)"
else
    warn "  crontab недоступен — cron-задачи НЕ настроены."
    warn "  Установите cron и перезапустите скрипт: sudo apt install -y cron"
fi

# -------- Финальный отчёт --------
echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  УСТАНОВКА ЗАВЕРШЕНА${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "  🌐 Сайт:        $SITE_URL"
echo "  📁 Папка:       $INSTALL_DIR"
echo "  🗄  БД:          $INSTALL_DIR/db/custom.db"
echo "  👤 Пользователь: $RUN_USER"
echo ""
if [[ "$IS_IP" == "true" ]]; then
echo "  Режим: HTTP-only (без HTTPS, без домена)"
echo "  Доступ: из локальной сети / ZeroTier по адресу выше"
echo ""
echo "  Если не открывается — проверьте:"
echo "    • ufw: sudo ufw status (порт 80 должен быть открыт)"
echo "    • ZeroTier: sudo zerotier-cli listnetworks (сеть должна быть OK)"
echo "    • Caddy:    sudo systemctl status caddy"
else
echo "  Режим: HTTPS (домен $DOMAIN)"
echo "  Сертификат Let's Encrypt получается автоматически (1-2 мин)"
fi
echo ""
echo "  Следующие шаги:"
echo "    1. Откройте $SITE_URL в браузере"
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
if [[ "$IS_IP" != "true" ]]; then
warn "  ⚠ Если домен за Cloudflare — отключите проксирование (серое облако)"
warn "    для этого поддомена, иначе Caddy не сможет получить HTTPS сертификат."
echo ""
fi
