#!/usr/bin/env bash
# Generate config from env vars, then start ClickHouse.
set -euo pipefail

ch-config generate /etc/clickhouse-server

# ch-config owns the default user. Left set, the official entrypoint reads
# CLICKHOUSE_PASSWORD_FILE again and replaces default in users.d/default-user.xml
# (plaintext password, access_management from its own env), and no secret
# file needs to be readable past this point.
unset CLICKHOUSE_PASSWORD CLICKHOUSE_PASSWORD_FILE
export CLICKHOUSE_SKIP_USER_SETUP=1

exec /entrypoint.sh "$@" --config-file=/etc/clickhouse-server/config.xml
