#!/usr/bin/env bash
# ClickHouse native RESTORE from the configured 'backups' disk.
#
# Required env:
#   CLICKHOUSE_HOST       — ClickHouse hostname (default: localhost)
#   CLICKHOUSE_USER       — ClickHouse user (default: default)
#   CLICKHOUSE_PASSWORD   — user password
#   BACKUP_DATABASE       — database to restore (default: langwatch)
#   BACKUP_NAME           — name of the backup to restore (required)
#   CONFIRM_RESTORE       — must be set to "yes" to proceed

set -euo pipefail
IFS=$'\n\t'

log() { printf '[restore] %s\n' "$*"; }

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD is required}"
BACKUP_DATABASE="${BACKUP_DATABASE:-langwatch}"
BACKUP_NAME="${BACKUP_NAME:-}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-no}"

if [ "${CONFIRM_RESTORE}" != "yes" ]; then
    log "CONFIRM_RESTORE is not 'yes' — aborting"
    log "To restore, create a Job from the CronJob template with:"
    log "  CONFIRM_RESTORE=yes"
    log "  BACKUP_NAME=<backup-name>"
    exit 1
fi

if [ -z "${BACKUP_NAME}" ]; then
    log "ERROR: BACKUP_NAME is required"
    exit 1
fi

if [[ ! "$BACKUP_DATABASE" =~ ^[a-zA-Z0-9_]+$ ]]; then
    log "ERROR: BACKUP_DATABASE contains invalid characters: ${BACKUP_DATABASE}"
    exit 1
fi
if [[ ! "$BACKUP_NAME" =~ ^[a-zA-Z0-9_/.-]+$ ]]; then
    log "ERROR: BACKUP_NAME contains invalid characters: ${BACKUP_NAME}"
    exit 1
fi

CH=(clickhouse-client --host="$CLICKHOUSE_HOST" --user="$CLICKHOUSE_USER" --password="$CLICKHOUSE_PASSWORD")

# Verify connectivity
log "verifying ClickHouse connectivity at ${CLICKHOUSE_HOST}..."
for attempt in $(seq 1 30); do
    if "${CH[@]}" --query="SELECT 1" >/dev/null 2>&1; then
        break
    fi
    if [ "${attempt}" -eq 30 ]; then
        log "ERROR: ClickHouse not reachable after 30 attempts"
        exit 1
    fi
    log "  waiting for ClickHouse (${attempt}/30)..."
    sleep 5
done
log "connected to ClickHouse"

log "starting restore of backup: ${BACKUP_NAME}"
log "target database: ${BACKUP_DATABASE}"

"${CH[@]}" --query="RESTORE DATABASE ${BACKUP_DATABASE} FROM Disk('backups', '${BACKUP_NAME}') SETTINGS allow_non_empty_tables=true"

log "restore of ${BACKUP_NAME} completed successfully"
