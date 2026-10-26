#!/bin/sh
# Copia de seguridad diaria de la base de datos. Guarda 14 días.
# Programar con cron (crontab -e):  30 3 * * * /ruta/al/proyecto/scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."
. ./.env
mkdir -p backups
FILE="backups/postural-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner | gzip > "$FILE"
find backups -name 'postural-*.sql.gz' -mtime +14 -delete
echo "Copia guardada en $FILE"
