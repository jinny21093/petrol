#!/usr/bin/env bash
#
# update.sh — обновление дашборда АЗС Вологды на сервере
#
# Запуск:
#   cd /var/www/vologda-azs
#   bash scripts/update.sh             # обычное обновление
#   bash scripts/update.sh --force     # принудительная пересборка
#   bash scripts/update.sh --help      # справка
#
# Стратегия надёжности:
#   - НЕ используем set -e (он убивает скрипт при любом ненулевом exit code,
#     что часто бывает в pipeline с grep/wc/git diff)
#   - Каждая ключевая команда проверяется вручную через if [[ $? -ne 0 ]]
#   - Вывод всех важных команд идёт в лог + на экран
#   - При ошибке — выводим понятное сообщение и продолжаем (где можно)
#     или останавливаемся с явным exit 1 (где нельзя продолжать)
#

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

# -------- Парсинг аргументов --------
FORCE_REBUILD=false
for arg in "$@"; do
    case "$arg" in
        --force|-f) FORCE_REBUILD=true ;;
        --help|-h)
            echo "Использование: bash scripts/update.sh [--force]"
            echo ""
            echo "Опции:"
            echo "  --force, -f   Принудительно пересобрать и перезапустить, даже если"
            echo "                новых коммитов нет. Полезно, если прошлый запуск упал"
            echo "                посередине и нужно доделать шаги 4-8."
            exit 0
            ;;
    esac
done

cd "$INSTALL_DIR" || { err "Не удалось перейти в $INSTALL_DIR"; exit 1; }
log "Папка проекта: $INSTALL_DIR"
if [[ "$FORCE_REBUILD" == "true" ]]; then
    warn "Режим --force: принудительная пересборка даже без новых коммитов."
fi

# -------- Шаг 1: проверка окружения --------
log "Шаг 1/8: проверка окружения..."

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

if command -v bun &> /dev/null; then
    ok "bun: $(bun --version) — будет использоваться для .ts скриптов"
else
    warn "bun не установлен — .ts скрипты будут запускаться через node + .mjs"
    warn "Рекомендуется установить: sudo npm install -g bun"
fi

ok "Окружение готово"

# -------- Шаг 2: git pull --------
log "Шаг 2/8: получение обновлений из git..."

# Сохраняем локальные изменения (кроме авто-генерируемых pnpm/bun файлов)
LOCAL_CHANGES_OUTPUT=$(git status --porcelain 2>&1)
LOCAL_CHANGES_COUNT=$(echo "$LOCAL_CHANGES_OUTPUT" | grep -c . || true)

if [[ "$LOCAL_CHANGES_COUNT" -gt 0 ]]; then
    warn "Обнаружены локальные изменения ($LOCAL_CHANGES_COUNT файлов):"
    echo "$LOCAL_CHANGES_OUTPUT" | sed 's/^/    /'

    # Откатываем автоматически модифицированные pnpm/bun файлы — они регенерируются
    if echo "$LOCAL_CHANGES_OUTPUT" | grep -qE '^.M package\.json$'; then
        warn "package.json модифицирован локально — откатываю"
        git checkout -- package.json 2>/dev/null || true
    fi
    if echo "$LOCAL_CHANGES_OUTPUT" | grep -qE '^\?\? pnpm-lock\.yaml$'; then
        warn "pnpm-lock.yaml untracked — удаляю"
        rm -f pnpm-lock.yaml
    fi
    if echo "$LOCAL_CHANGES_OUTPUT" | grep -qE '^\?\? bun\.lock$'; then
        warn "bun.lock untracked — удаляю"
        rm -f bun.lock
    fi

    # Проверяем, остались ли ещё локальные изменения
    REMAINING_OUTPUT=$(git status --porcelain 2>&1)
    REMAINING_COUNT=$(echo "$REMAINING_OUTPUT" | grep -c . || true)
    if [[ "$REMAINING_COUNT" -gt 0 ]]; then
        warn "Остались локальные изменения ($REMAINING_COUNT файлов). Сохраняю через git stash..."
        git stash push -m "auto-stash before update $(date +%s)" --include-untracked 2>&1 || warn "git stash не удался, продолжаю без него"
    else
        ok "Все локальные изменения откачены, stash не нужен"
    fi
fi

BEFORE_COMMIT=$(git rev-parse HEAD 2>&1)
log "Текущий коммит: $BEFORE_COMMIT"

# Тянем свежий код
PULL_OUTPUT=$(git pull --ff-only origin main 2>&1)
PULL_EXIT=$?
echo "$PULL_OUTPUT"

if [[ $PULL_EXIT -ne 0 ]]; then
    err "git pull не удался (exit $PULL_EXIT). Возможен конфликт."
    err "Решите вручную: cd $INSTALL_DIR && git status"
    # Пробуем восстановить stash если был
    if [[ "$REMAINING_COUNT" -gt 0 ]]; then
        warn "Восстанавливаю stash..."
        git stash pop 2>&1 || warn "Не удалось восстановить stash. Проверьте: git stash list"
    fi
    exit 1
fi

AFTER_COMMIT=$(git rev-parse HEAD 2>&1)

if [[ "$BEFORE_COMMIT" == "$AFTER_COMMIT" ]]; then
    if [[ "$FORCE_REBUILD" == "true" ]]; then
        warn "Код не изменился (commit $AFTER_COMMIT), но запрошен --force — прогоняю все шаги."
    else
        ok "Уже актуально (commit $AFTER_COMMIT). Нечего обновлять."
        echo ""
        ok "Обновление не требуется."
        echo "Если нужно принудительно пересобрать и перезапустить — запустите:"
        echo "  bash scripts/update.sh --force"
        exit 0
    fi
else
    ok "Обновлено: $BEFORE_COMMIT → $AFTER_COMMIT"
    ok "Последний коммит: $(git log -1 --pretty='%h %s (%cr by %an)')"
fi

# Восстанавливаем stash если был
if [[ "$REMAINING_COUNT" -gt 0 ]]; then
    warn "Восстанавливаю локальные изменения..."
    git stash pop 2>&1 || warn "Не удалось восстановить stash. Проверьте: git stash list"
fi

# -------- Шаг 3: установка зависимостей --------
log "Шаг 3/8: установка зависимостей (pnpm install)..."

# Проверяем, менялся ли package.json или bun.lock (при --force — всегда выполняем)
PACKAGES_CHANGED=0
if [[ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ]]; then
    DIFF_OUTPUT=$(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" 2>/dev/null)
    if echo "$DIFF_OUTPUT" | grep -qE '^(package\.json|bun\.lock|pnpm-lock\.yaml)$'; then
        PACKAGES_CHANGED=1
    fi
fi

if [[ "$PACKAGES_CHANGED" -eq 1 ]] || [[ "$FORCE_REBUILD" == "true" ]]; then
    log "Запускаю pnpm install..."
    pnpm install 2>&1
    PIPM_EXIT=$?

    if [[ $PIPM_EXIT -ne 0 ]]; then
        warn "pnpm install завершился с кодом $PIPM_EXIT"
        warn "Это обычно не критично (часто из-за ignored build scripts)."
        warn "Если приложение не запустится — выполните вручную:"
        warn "    pnpm approve-builds"
    else
        ok "Зависимости обновлены"
    fi
else
    ok "package.json не менялся, пропуск pnpm install"
fi

# -------- Шаг 4: применение схемы БД + перепарсинг + cleanup --------
log "Шаг 4/8: проверка схемы БД (prisma)..."

# Проверяем, менялась ли схема
SCHEMA_CHANGED=0
if [[ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ]]; then
    DIFF_OUTPUT=$(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" 2>/dev/null)
    if echo "$DIFF_OUTPUT" | grep -qE '^prisma/schema\.prisma$'; then
        SCHEMA_CHANGED=1
    fi
fi

if [[ "$SCHEMA_CHANGED" -eq 1 ]]; then
    warn "Схема БД изменилась, применяю миграцию..."
    pnpm prisma db push 2>&1
    if [[ $? -ne 0 ]]; then
        err "prisma db push не удался. Проверьте схему."
        exit 1
    fi
    ok "Схема применена"
elif [[ "$FORCE_REBUILD" == "true" ]]; then
    warn "--force: проверяю, что БД в синке со схемой..."
    pnpm prisma db push 2>&1
    if [[ $? -ne 0 ]]; then
        warn "prisma db push завершился с ошибкой, но продолжаю (возможно, БД уже в синке)"
    else
        ok "Схема синхронизирована"
    fi
else
    ok "Схема БД не менялась"
fi

log "Генерирую Prisma Client..."
pnpm prisma generate 2>&1
if [[ $? -ne 0 ]]; then
    err "prisma generate не удался. Это критично — без него приложение не запустится."
    exit 1
fi
ok "Prisma Client сгенерирован"

# Перепарсить существующие снапшоты (через bun + bun:sqlite)
if [[ -f "scripts/reparse-snapshots.ts" ]]; then
    log "Перепарсинг существующих снапшотов..."
    if command -v bun &> /dev/null; then
        bun run scripts/reparse-snapshots.ts 2>&1 | tail -5
    else
        warn "bun не установлен — пропуск перепарсинга"
    fi
    ok "Перепарсинг завершён"
fi

# Cleanup дубликатов станций
if [[ -f "scripts/cleanup-duplicates.ts" ]]; then
    log "Cleanup дубликатов станций (если есть)..."
    if command -v bun &> /dev/null; then
        bun run scripts/cleanup-duplicates.ts 2>&1 | tail -10
    else
        warn "bun не установлен — пропуск cleanup"
    fi
    ok "Cleanup завершён"
fi

# -------- Шаг 5: сборка Next.js --------
log "Шаг 5/8: сборка Next.js (output: standalone)..."

pnpm build 2>&1
BUILD_EXIT=$?

if [[ $BUILD_EXIT -ne 0 ]]; then
    err "Сборка Next.js не удалась (exit $BUILD_EXIT)."
    err "Приложение оставлено в прежнем состоянии (PM2 работает на старой версии)."
    exit 1
fi

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

ok "Сборка готова"

# -------- Шаг 6: перезапуск PM2 --------
log "Шаг 6/8: перезапуск PM2..."

# Останавливаем старый процесс если был, потом запускаем заново
pm2 restart "$APP_NAME" --update-env 2>&1
if [[ $? -ne 0 ]]; then
    warn "Приложение не запущено в PM2, пытаюсь запустить..."
    if [[ -f "ecosystem.config.js" ]]; then
        pm2 start ecosystem.config.js 2>&1
    else
        err "Нет ecosystem.config.js. Запустите install.sh заново."
        exit 1
    fi
fi

sleep 3

# Проверяем статус
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
    err "Приложение не запустилось (статус: $PM2_STATUS)"
    err "Логи: pm2 logs $APP_NAME --lines 50"
    exit 1
fi

ok "PM2: $APP_NAME online"

# -------- Шаг 7: проверка работоспособности --------
log "Шаг 7/8: проверка, что приложение отвечает на :3000..."

HEALTH_OK=false
for i in 1 2 3 4 5; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/ 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        HEALTH_OK=true
        break
    fi
    warn "Попытка $i: HTTP $HTTP_CODE, жду 2 сек..."
    sleep 2
done

if [[ "$HEALTH_OK" != "true" ]]; then
    err "Приложение не отвечает на http://127.0.0.1:3000/"
    err "Проверьте логи: pm2 logs $APP_NAME --lines 50"
    exit 1
fi

ok "Приложение отвечает (HTTP 200)"

# -------- Шаг 8: обновление cron-задач --------
log "Шаг 8/8: обновление cron-задач..."

mkdir -p /var/log/vologda-azs /var/backups/vologda-azs 2>/dev/null || true

CRON_MARK_BEGIN="# >>> vologda-azs begin >>>"
CRON_MARK_END="# <<< vologda-azs end <<<"

# Определяем пользователя
CRON_USER="${SUDO_USER:-$USER}"

# Удаляем старый блок и добавляем новый
NEW_CRON=$(crontab -u "$CRON_USER" -l 2>/dev/null | sed "/$CRON_MARK_BEGIN/,/$CRON_MARK_END/d")
NEW_CRON="$NEW_CRON
$CRON_MARK_BEGIN
*/5 * * * * curl -fsS -m 10 -X GET http://127.0.0.1:3000/api/cookie-check > /dev/null 2>&1 || true
*/10 * * * * bash $(pwd)/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1 || true
0 3 * * * sqlite3 $(pwd)/db/custom.db \".backup '/var/backups/vologda-azs/\$(date +\\%F).db'\" && find /var/backups/vologda-azs -mtime +14 -delete > /dev/null 2>&1 || true
$CRON_MARK_END"

echo "$NEW_CRON" | crontab -u "$CRON_USER" - 2>&1
if [[ $? -ne 0 ]]; then
    warn "Не удалось обновить cron-задачи. Проверьте права на crontab."
else
    ok "Cron обновлён (heartbeat каждые 5 мин, опрос каждые 10 мин, бэкап в 03:00)"
fi

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
