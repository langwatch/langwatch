#!/usr/bin/env bash
# Generate config from env vars, then start ClickHouse.
set -euo pipefail

ch-config generate /etc/clickhouse-server

# ch-config owns the default user: skip the official entrypoint's user setup,
# which would replace it in users.d/default-user.xml (plaintext password, no
# access_management). Its initdb step and CLICKHOUSE_DB still log in as
# default, so they get the password ch-config used, and only they do.
export CLICKHOUSE_SKIP_USER_SETUP=1
default_password_file="${CLICKHOUSE_PASSWORD_FILE:-}"
# Dynamic-only mode (ADR-190): default has no password, so initdb logs in as
# the local admin with the password ch-config generated for this start.
bootstrap_password="${CLICKHOUSE_ACCESS_BOOTSTRAP_DIR:-/run/clickhouse-access}/password"
initdb_user=""
if [ -s "$bootstrap_password" ]; then
    initdb_user=local_admin
    CLICKHOUSE_PASSWORD="$(<"$bootstrap_password")"
elif [ -n "${CLICKHOUSE_PASSWORD_FILE:-}" ]; then
    CLICKHOUSE_PASSWORD="$(<"$CLICKHOUSE_PASSWORD_FILE")"
    CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD#"${CLICKHOUSE_PASSWORD%%[![:space:]]*}"}"
    CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD%"${CLICKHOUSE_PASSWORD##*[![:space:]]}"}"
fi
unset CLICKHOUSE_PASSWORD_FILE

# The official entrypoint initialises only for server flags (none, or "--..."),
# not for the image's default "clickhouse-server" command.
initdb_inputs=""
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    initdb_inputs="${CLICKHOUSE_DB:-}$(ls -A /docker-entrypoint-initdb.d 2>/dev/null || true)"
fi
if [ -n "$initdb_inputs" ]; then
    export CLICKHOUSE_PASSWORD
    if [ -n "$initdb_user" ]; then
        export CLICKHOUSE_USER="$initdb_user"
    fi
else
    unset CLICKHOUSE_PASSWORD
fi

# With an access file and no sidecar container of its own (the chart runs one
# and sets CLICKHOUSE_ACCESS_SIDECAR=external), run it here, restarted if it
# exits: token logins and password rotation depend on it (ADR-190). Scheduled
# backups (BACKUP_SIDECAR=run|observe) run in the same process (ADR-191).
embedded_access=""
if [ -n "${CLICKHOUSE_ACCESS_FILE:-}" ] && [ "${CLICKHOUSE_ACCESS_SIDECAR:-embedded}" = "embedded" ]; then
    embedded_access=1
fi
embedded_backups=""
case "${BACKUP_SIDECAR:-off}" in off | "") ;; *) embedded_backups=1 ;; esac
if [ -n "$embedded_access" ] || [ -n "$embedded_backups" ]; then
    (
        unset CLICKHOUSE_PASSWORD
        # initdb's local_admin login is not the backup user.
        [ -z "$initdb_user" ] || unset CLICKHOUSE_USER
        [ -n "$embedded_access" ] || unset CLICKHOUSE_ACCESS_FILE
        # Backups log in from a file only: the local admin's when dynamic-only,
        # else BACKUP_PASSWORD_FILE or the server's own password file.
        if [ -n "$embedded_backups" ]; then
            export BACKUP_PASSWORD_FILE="${BACKUP_PASSWORD_FILE:-$default_password_file}"
        fi
        while true; do ch-config sidecar /etc/clickhouse-server || true; sleep 2; done
    ) &
fi

exec /entrypoint.sh "$@" --config-file=/etc/clickhouse-server/config.xml
