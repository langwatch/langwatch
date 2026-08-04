#!/usr/bin/env bash
# ClickHouse native BACKUP to the configured 'backups' disk.
# Supports full and incremental modes.
#
# Required env:
#   CLICKHOUSE_HOST       — ClickHouse hostname (default: localhost)
#   CLICKHOUSE_USER       — ClickHouse user (default: default)
#   CLICKHOUSE_PASSWORD   — user password
#   BACKUP_MODE           — "full" or "incremental"
#   BACKUP_DATABASE       — database to back up (default: langwatch)
#
# The 'backups' disk (S3-backed, s3_plain) is configured by the ClickHouse
# image when BACKUP_ENABLED=true. Credentials are inherited from the disk config.

set -euo pipefail
IFS=$'\n\t'

log() { printf '[backup] %s\n' "$*"; }

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD is required}"
BACKUP_MODE="${BACKUP_MODE:-full}"
BACKUP_DATABASE="${BACKUP_DATABASE:-langwatch}"

if [[ ! "$BACKUP_DATABASE" =~ ^[a-zA-Z0-9_]+$ ]]; then
    log "ERROR: BACKUP_DATABASE contains invalid characters: ${BACKUP_DATABASE}"
    exit 1
fi
if [[ "$BACKUP_MODE" != "full" && "$BACKUP_MODE" != "incremental" ]]; then
    log "ERROR: BACKUP_MODE must be 'full' or 'incremental' (got '${BACKUP_MODE}')"
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

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_NAME="${BACKUP_DATABASE}_${BACKUP_MODE}_${TIMESTAMP}"

log "starting ${BACKUP_MODE} backup: ${BACKUP_NAME}"

if [ "${BACKUP_MODE}" = "incremental" ]; then
    # Find the latest full backup to use as base (query by id — we set id=name on creation)
    LATEST_FULL=$("${CH[@]}" --query="
        SELECT id FROM system.backups
        WHERE id LIKE '${BACKUP_DATABASE}_full_%'
          AND status = 'BACKUP_CREATED'
        ORDER BY start_time DESC
        LIMIT 1
    " || true)

    if [ -z "${LATEST_FULL}" ]; then
        log "no full backup found — performing full backup instead"
        BACKUP_MODE="full"
        BACKUP_NAME="${BACKUP_DATABASE}_full_${TIMESTAMP}"
    fi
fi

if [ "${BACKUP_MODE}" = "full" ]; then
    "${CH[@]}" --query="BACKUP DATABASE ${BACKUP_DATABASE} TO Disk('backups', '${BACKUP_NAME}') SETTINGS id='${BACKUP_NAME}'"
else
    "${CH[@]}" --query="BACKUP DATABASE ${BACKUP_DATABASE} TO Disk('backups', '${BACKUP_NAME}') SETTINGS id='${BACKUP_NAME}', base_backup = Disk('backups', '${LATEST_FULL}')"
fi

log "backup ${BACKUP_NAME} completed successfully"

# Prune old backups: keep last 7 full backups.
# Any incrementals older than the oldest kept full are also pruned
# (they depend on a full that no longer exists).
log "checking for old backups to prune..."
OLDEST_KEPT_TS=$("${CH[@]}" --query="
    SELECT start_time FROM system.backups
    WHERE id LIKE '${BACKUP_DATABASE}_full_%'
      AND status = 'BACKUP_CREATED'
    ORDER BY start_time DESC
    LIMIT 1 OFFSET 6
" 2>/dev/null || true)

if [ -n "${OLDEST_KEPT_TS}" ]; then
    STALE=$("${CH[@]}" --query="
        SELECT id FROM system.backups
        WHERE (id LIKE '${BACKUP_DATABASE}_full_%' OR id LIKE '${BACKUP_DATABASE}_incremental_%')
          AND status = 'BACKUP_CREATED'
          AND start_time < '${OLDEST_KEPT_TS}'
    " 2>/dev/null || true)

    while IFS= read -r backup_id; do
        [ -z "${backup_id}" ] && continue
        log "pruning old backup: ${backup_id}"
        "${CH[@]}" --query="DROP BACKUP IF EXISTS Disk('backups', '${backup_id}')" 2>/dev/null || true
    done <<< "${STALE}"
fi

log "backup job finished"
