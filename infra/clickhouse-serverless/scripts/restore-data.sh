#!/usr/bin/env bash
# Restores one backup from the 'backups' disk: `ch-config backup restore` (ADR-185).
# Kept at this path for the chart's restore template and existing runbooks.
#
# Env, as before: CLICKHOUSE_HOST, CLICKHOUSE_USER (default default),
# CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE, BACKUP_DATABASE, BACKUP_NAME
# (exact name, never "latest"; `ch-config backup list` prints them) and
# CONFIRM_RESTORE=yes, without which nothing is restored.
set -euo pipefail
export CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
exec ch-config backup restore "$@"
