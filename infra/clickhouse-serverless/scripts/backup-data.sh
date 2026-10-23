#!/usr/bin/env bash
# Takes one native BACKUP to the 'backups' disk: `ch-config backup run` (ADR-191).
# Kept at this path for the chart's CronJobs and existing runbooks.
#
# Env, as before: CLICKHOUSE_HOST (default localhost), CLICKHOUSE_USER (default
# default), CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE, BACKUP_MODE (full or
# incremental), BACKUP_DATABASE (default langwatch). Also BACKUP_RETENTION_DAYS,
# STALE_BACKUP_HOURS, BACKUP_CLUSTER, BACKUP_MAX_BANDWIDTH; see the README.
set -euo pipefail
export CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
exec ch-config backup run "$@"
