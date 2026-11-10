#!/usr/bin/env bash
# Generate config from env vars, then start ClickHouse.
set -euo pipefail

ch-config generate /etc/clickhouse-server

default_password_file="${CLICKHOUSE_PASSWORD_FILE:-}"
# Dynamic-only mode (ADR-198): default has no password, so initdb logs in as
# the local admin with the password ch-config generated for this start.
bootstrap_password="${CLICKHOUSE_ACCESS_BOOTSTRAP_DIR:-/run/clickhouse-access}/password"
initdb_user=""
initdb_password_file="$default_password_file"
if [ -s "$bootstrap_password" ]; then
    initdb_user=local_admin
    initdb_password_file="$bootstrap_password"
fi
unset CLICKHOUSE_PASSWORD_FILE

# ch-config owns the default user: skip the official entrypoint's user setup,
# which would replace it in users.d/default-user.xml. An install that named its
# own CLICKHOUSE_USER keeps the official setup, which creates that user as before.
custom_user=""
if [ -z "$initdb_user" ] && [ -n "${CLICKHOUSE_USER:-}" ] && [ "$CLICKHOUSE_USER" != "default" ]; then
    custom_user=1
else
    export CLICKHOUSE_SKIP_USER_SETUP=1
fi

# The official entrypoint initialises only for server flags (none, or "--..."),
# not for the image's default "clickhouse-server" command.
initdb_inputs=""
if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
    initdb_inputs="${CLICKHOUSE_DB:-}$(ls -A /docker-entrypoint-initdb.d 2>/dev/null || true)"
fi
# The official entrypoint reads a password file into a variable it does not
# export, so the server's environment never holds the password. Only a padded
# file, which ch-config trims and the official entrypoint does not, goes by env.
if [ -n "$initdb_inputs" ] || [ -n "$custom_user" ]; then
    if [ -n "$initdb_password_file" ]; then
        raw="$(<"$initdb_password_file")"
        trimmed="${raw#"${raw%%[![:space:]]*}"}"
        trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
        if [ -n "$custom_user" ] || [ "$raw" = "$trimmed" ]; then
            export CLICKHOUSE_PASSWORD_FILE="$initdb_password_file"
            unset CLICKHOUSE_PASSWORD
        else
            export CLICKHOUSE_PASSWORD="$trimmed"
        fi
        unset raw trimmed
    fi
    if [ -n "$initdb_user" ]; then
        export CLICKHOUSE_USER="$initdb_user"
    fi
else
    unset CLICKHOUSE_PASSWORD
fi

# With an access file and no sidecar container of its own (the chart runs one
# and sets CLICKHOUSE_ACCESS_SIDECAR=external), run it here, restarted if it
# exits: token logins and password rotation depend on it (ADR-198). Scheduled
# backups (BACKUP_SIDECAR=run|observe) run in the same process (ADR-199).
embedded_access=""
if [ -n "${CLICKHOUSE_ACCESS_FILE:-}" ] && [ "${CLICKHOUSE_ACCESS_SIDECAR:-embedded}" = "embedded" ]; then
    embedded_access=1
fi
embedded_backups=""
case "${BACKUP_SIDECAR:-off}" in off | "") ;; *) embedded_backups=1 ;; esac
if [ -n "$embedded_access" ] || [ -n "$embedded_backups" ]; then
    (
        unset CLICKHOUSE_PASSWORD CLICKHOUSE_PASSWORD_FILE
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
