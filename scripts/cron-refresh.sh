#!/usr/bin/env bash
#
# cron-refresh.sh — лёгкий скрипт для ручного запуска обновления данных
# через cron. Дёргает локальный /api/refresh без внешнего DNS/HTTPS.
#
# Запуск вручную:
#   bash scripts/cron-refresh.sh
#
# Установка в cron (уже сделана install.sh, но если нужно вручную):
#   crontab -e
#   */10 * * * * /var/www/vologda-azs/scripts/cron-refresh.sh >> /var/log/vologda-azs/cron.log 2>&1
#
# Почему не просто curl https://domain/api/refresh?
#   — Локальный вызов быстрее (нет TLS handshake, нет DNS lookup)
#   — Работает даже если Caddy временно недоступен
#   — Не нагружает Caddy лишним запросом
#

set -euo pipefail

PORT="${PORT:-3000}"
URL="http://127.0.0.1:${PORT}/api/refresh"
LOG_PREFIX="[cron-refresh $(date '+%Y-%m-%d %H:%M:%S')]"

RESPONSE=$(curl -s -m 30 -X POST "$URL" 2>&1) || {
    echo "$LOG_PREFIX ERROR: запрос не выполнен: $RESPONSE"
    exit 1
}

# Парсим JSON-ответ
STATS=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        print(f\"ERROR: {d['error']}\")
    else:
        print(f\"OK points={d.get('pointsProcessed',0)} found={d.get('stationsFound',0)} new={d.get('stationsNew',0)} updated={d.get('stationsUpdated',0)} errors={len(d.get('errors',[]))}\")
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
