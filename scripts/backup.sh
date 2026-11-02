#!/usr/bin/env bash
# Sao lưu PostgreSQL, giữ 14 bản gần nhất. Chạy hằng ngày bằng cron:
#   15 3 * * * cd /srv/tam-an && npm run backup >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_URL:?Thiếu DATABASE_URL}"
mkdir -p backups
file="backups/tam-an-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$file"
echo "Đã sao lưu: $file ($(du -h "$file" | cut -f1))"
ls -1t backups/tam-an-*.dump | tail -n +15 | xargs -r rm --
# Khôi phục: pg_restore --clean --no-owner -d "$DATABASE_URL" backups/<tệp>.dump
