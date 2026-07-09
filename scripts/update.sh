#!/usr/bin/env bash
#
# update.sh — обновление дашборда АЗС Вологды на сервере
#
# Запуск (от пользователя-владельца установки, можно через sudo -u):
#   cd /var/www/vologda-azs
#   bash scripts/update.sh
#
# Что делает:
#   1. git pull (с прерыванием при конфликтах)
#   2. pnpm install (если поменялись зависимости)
#   3. pnpm prisma db push (если поменялась схема БД)
#   4. pnpm prisma generate
#   5. pnpm build (с копированием public/ и .next/static в standalone)
#   6. pm2 restart vologda-azs
#   7. Проверка, что приложение отвечает на :3000
#
# Безопасность: не трогает .env и db/custom.db.
#

set -euo pipefail

# -------- Цвета --------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*" >&2; }

APP_NAME="vologda-azs"
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
START_TIME=$(date +%s)

# Переходим в папку проекта
cd "$INSTALL_DIR"
log "Папка проекта: $INSTALL_DIR"

# -------- 1. Проверка предусловий --------
log "Шаг 1/7: проверка окружения..."

if [[ ! -d ".git" ]]; then
    err "Это не git-репозиторий. Запускайте из корня проекта."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    err "pnpm не установлен. Установите: sudo npm install -g pnpm"
    exit 1
fi

if ! command -v pm2 &> /dev/null; then
    err "PM2 не установлен. Установите: sudo npm install -g pm2"
    exit 1
fi

# bun опционален — без него скрипты .ts запустятся через .mjs fallback
if command -v bun &> /dev/null; then
    ok "  bun: $(bun --version) — будет использоваться для .ts скриптов"
else
    warn "  bun не установлен — .ts скрипты будут запускаться через node + .mjs"
    warn "  Рекомендуется установить: sudo npm install -g bun"
fi

ok "  Окружение готово"

# -------- 2. git pull --------
log "Шаг 2/7: получение обновлений из git..."

# Сохраняем локальные изменения, если есть (например, в Caddyfile)
LOCAL_CHANGES=$(git status --porcelain 2>&1 | wc -l)
if [[ "$LOCAL_CHANGES" -gt 0 ]]; then
    warn "  Обнаружены локальные изменения ($LOCAL_CHANGES файлов). Сохраняю через git stash..."
    git stash push -m "auto-stash before update $(date +%s)"
fi

# Тянем свежий код
BEFORE_COMMIT=$(git rev-parse HEAD)
if ! git pull --ff-only origin main 2>&1; then
    err "  git pull не удался. Возможен конфликт."
    err "  Решите вручную: cd $INSTALL_DIR && git status"
    if [[ "$LOCAL_CHANGES" -gt 0 ]]; then
        warn "  Восстанавливаю stash с локальными изменениями..."
        git stash pop || warn "  Не удалось восстановить stash. Проверьте: git stash list"
    fi
    exit 1
fi
AFTER_COMMIT=$(git rev-parse HEAD)

if [[ "$BEFORE_COMMIT" == "$AFTER_COMMIT" ]]; then
    ok "  Уже актуально (commit $AFTER_COMMIT). Нечего обновлять."
    # Восстанавливаем stash если был
    if [[ "$LOCAL_CHANGES" -gt 0 ]]; then
        git stash pop || warn "  Не удалось восстановить stash. Проверьте: git stash list"
    fi
    echo ""
    ok "Обновление не требуется."
    exit 0
fi

ok "  Обновлено: $BEFORE_COMMIT → $AFTER_COMMIT"
ok "  Последний коммит: $(git log -1 --pretty='%h %s (%cr by %an)')"

# Восстанавливаем stash если был
if [[ "$LOCAL_CHANGES" -gt 0 ]]; then
    warn "  Восстанавливаю локальные изменения..."
    git stash pop || warn "  Не удалось восстановить stash автоматически. Проверьте: git stash list"
fi

# -------- 3. Установка зависимостей --------
log "Шаг 3/7: установка зависимостей (pnpm install)..."

# Проверяем, менялся ли package.json или bun.lock
PACKAGES_CHANGED=$(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" | grep -E '^(package\.json|bun\.lock|pnpm-lock\.yaml)$' | wc -l)
if [[ "$PACKAGES_CHANGED" -gt 0 ]]; then
    # pnpm может возвращать ненулевой exit code из-за warning'ов об ignored build
    # scripts (Prisma, sharp, @swc/core). Это не фатально — сами пакеты ставятся.
    # Поэтому отключаем pipefail на время pnpm install.
    set +e
    pnpm install 2>&1 | tee /tmp/pnpm-install.log
    PIPM_EXIT=${PIPESTATUS[0]}
    set -e
    if [[ $PIPM_EXIT -ne 0 ]]; then
        warn "  pnpm install завершился с кодом $PIPM_EXIT (вероятно, из-за ignored build scripts)"
        warn "  Это обычно не критично. Если приложение не запустится — выполните вручную:"
        warn "    pnpm approve-builds   (отметить нужные пакеты пробелом, затем Enter)"
        warn "  Или добавьте в package.json:"
        warn '    "pnpm": { "onlyBuiltDependencies": ["@prisma/client","@prisma/engines","prisma","sharp","@swc/core","@parcel/watcher","unrs-resolver","es5-ext"] }'
    else
        ok "  Зависимости обновлены"
    fi
else
    ok "  package.json не менялся, пропуск pnpm install"
fi

# -------- 4. Применение схемы БД --------
log "Шаг 4/7: проверка схемы БД (prisma)..."

SCHEMA_CHANGED=$(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" | grep -E '^prisma/schema\.prisma$' | wc -l)
if [[ "$SCHEMA_CHANGED" -gt 0 ]]; then
    warn "  Схема БД изменилась, применяю миграцию..."
    pnpm prisma db push
    ok "  Схема применена"
else
    ok "  Схема БД не менялась"
fi

pnpm prisma generate
ok "  Prisma Client сгенерирован"

# Перепарсить существующие снапшоты, если менялся парсер топлива
# (быстро: просто перезаписывает parsedFuels для всех записей)
if [[ -f "scripts/reparse-snapshots.ts" ]]; then
    log "  Перепарсинг существующих снапшотов (на случай обновления парсера)..."
    if command -v bun &> /dev/null; then
        # Preferred: bun умеет запускать .ts напрямую, без компиляции
        bun run scripts/reparse-snapshots.ts 2>&1 | tail -5 || warn "  Перепарсинг не удался (не критично, продолжаю)"
    elif [[ -f "scripts/reparse-snapshots.mjs" ]]; then
        # Fallback: node + .mjs (если bun не установлен)
        node scripts/reparse-snapshots.mjs 2>&1 | tail -5 || warn "  Перепарсинг не удался (не критично, продолжаю)"
    fi
fi

# -------- 5. Сборка Next.js --------
log "Шаг 5/7: сборка Next.js (output: standalone)..."

pnpm build

# Копируем public/ и .next/static в standalone (требуется для standalone-сервера)
if [[ -d "public" ]]; then
    rm -rf ".next/standalone/public"
    cp -r public ".next/standalone/public"
fi
if [[ -d ".next/static" ]]; then
    mkdir -p ".next/standalone/.next"
    rm -rf ".next/standalone/.next/static"
    cp -r ".next/static" ".next/standalone/.next/static"
fi

ok "  Сборка готова"

# -------- 6. Перезапуск PM2 --------
log "Шаг 6/7: перезапуск PM2..."

pm2 restart "$APP_NAME" --update-env 2>&1 || {
    warn "  Приложение не запущено в PM2, пытаюсь запустить..."
    if [[ -f "ecosystem.config.js" ]]; then
        pm2 start ecosystem.config.js
    else
        err "  Нет ecosystem.config.js. Запустите install.sh заново."
        exit 1
    fi
}

sleep 2
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try:
    apps = json.load(sys.stdin)
    for a in apps:
        if a.get('name') == '$APP_NAME':
            print(a.get('pm2_env', {}).get('status', 'unknown'))
            sys.exit(0)
    print('not_found')
except Exception:
    print('error')
" 2>/dev/null || echo "error")

if [[ "$PM2_STATUS" != "online" ]]; then
    err "  Приложение не запустилось (статус: $PM2_STATUS)"
    err "  Логи: pm2 logs $APP_NAME --lines 50"
    exit 1
fi

ok "  PM2: $APP_NAME online"

# -------- 7. Проверка работоспособности --------
log "Шаг 7/7: проверка, что приложение отвечает на :3000..."

HEALTH_OK=false
for i in 1 2 3 4 5; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/ 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        HEALTH_OK=true
        break
    fi
    warn "  Попытка $i: HTTP $HTTP_CODE, жду 2 сек..."
    sleep 2
done

if [[ "$HEALTH_OK" != "true" ]]; then
    err "  Приложение не отвечает на http://127.0.0.1:3000/"
    err "  Проверьте логи: pm2 logs $APP_NAME --lines 50"
    exit 1
fi

ok "  Приложение отвечает (HTTP 200)"

# -------- Финальный отчёт --------
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  ОБНОВЛЕНИЕ ЗАВЕРШЕНО${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "  Коммит:     $(git log -1 --pretty='%h %s')"
echo "  Автор:      $(git log -1 --pretty='%an')"
echo "  Время:      $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Заняло:     ${DURATION} сек"
echo ""
echo "  Логи: pm2 logs $APP_NAME --lines 30"
echo ""
