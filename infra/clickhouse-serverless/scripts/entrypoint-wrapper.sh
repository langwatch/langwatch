#!/usr/bin/env bash
# Generate config from env vars, then start ClickHouse.
set -euo pipefail

ch-config generate /etc/clickhouse-server

# ch-config owns the default user: skip the official entrypoint's user setup,
# which would replace it in users.d/default-user.xml (plaintext password, no
# access_management). Its initdb step and CLICKHOUSE_DB still log in as
# default, so they get the password ch-config used, and only they do.
export CLICKHOUSE_SKIP_USER_SETUP=1
if [ -n "${CLICKHOUSE_PASSWORD_FILE:-}" ]; then
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
else
    unset CLICKHOUSE_PASSWORD
fi

exec /entrypoint.sh "$@" --config-file=/etc/clickhouse-server/config.xml
