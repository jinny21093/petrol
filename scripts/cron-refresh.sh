#!/usr/bin/env bash
#
# cron-refresh.sh — лёгкий скрипт для ручного запуска обновления данных
# через cron. Сначала проверяет статус куки через /api/cookie-check
# (лёгкий запрос), и только если кука жива — запускает полный опрос.
#
# Запуск вручную:
#   bash scripts/cron-refresh.sh
#
# Установка в cron (уже сделана install.sh, но если нужно вручную):
#   crontab -e
#   */10 * * * * /var/www/vologda-azs/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1
#
# Почему сначала cookie-check:
#   - Если кука протухла, /api/refresh всё равно сделает 9 запросов к геопорталу
#     и только потом поймёт, что они вернули SupportESIA. Это лишний трафик и время.
#   - /api/cookie-check делает ОДИН лёгкий GET к /api/info — мгновенно понимает,
#     жива ли кука.
#   - Заодно heartbeat-запрос к /api/info может продлевать сессию (если геопортал
#     это поддерживает) — многие Tomcat-сессии продлеваются от активности.
#

set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
LOG_PREFIX="[cron-refresh $(date '+%Y-%m-%d %H:%M:%S')]"

# -------- Шаг 1: heartbeat / проверка куки --------
HEARTBEAT=$(curl -s -m 10 "${BASE}/api/cookie-check" 2>&1) || {
    echo "$LOG_PREFIX ERROR: heartbeat-запрос не выполнен: $HEARTBEAT"
    exit 1
}

COOKIE_STATUS=$(echo "$HEARTBEAT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('status', 'unknown'))
except Exception:
    print('parse_error')
" 2>&1)

echo "$LOG_PREFIX cookie-status=$COOKIE_STATUS"

# Если кука протухла или не задана — не делаем полный опрос
if [[ "$COOKIE_STATUS" == "expired" ]]; then
    echo "$LOG_PREFIX SKIP refresh: JSESSIONID протухла. Требуется ручное обновление через дашборд."
    # TODO: добавить отправку в Telegram, если настроен бот
    exit 0
fi
if [[ "$COOKIE_STATUS" == "not_set" ]]; then
    echo "$LOG_PREFIX SKIP refresh: JSESSIONID не задана в настройках."
    exit 0
fi
if [[ "$COOKIE_STATUS" == "unknown" || "$COOKIE_STATUS" == "parse_error" ]]; then
    echo "$LOG_PREFIX WARN: статус куки неизвестен, пробую опрос в любом случае..."
fi

# -------- Шаг 2: полный опрос АЗС --------
RESPONSE=$(curl -s -m 60 -X POST "${BASE}/api/refresh" 2>&1) || {
    echo "$LOG_PREFIX ERROR: /api/refresh не выполнен: $RESPONSE"
    exit 1
}

STATS=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        print(f\"ERROR: {d['error']}\")
    else:
        cs = d.get('cookieStatus', 'unknown')
        print(f\"OK points={d.get('pointsProcessed',0)} found={d.get('stationsFound',0)} new={d.get('stationsNew',0)} updated={d.get('stationsUpdated',0)} errors={len(d.get('errors',[]))} cookie={cs}\")
except Exception as e:
    print(f\"PARSE_ERROR: {e}\")
" 2>&1)

echo "$LOG_PREFIX $STATS"

# Если были ошибки — выводим их
echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for e in d.get('errors', []):
        print(f'  ERROR: {e}')
except Exception:
    pass
" 2>&1 || true
