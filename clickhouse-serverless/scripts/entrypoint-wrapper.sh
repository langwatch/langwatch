#!/usr/bin/env bash
# Generate config from env vars, then start ClickHouse.
set -euo pipefail

ch-config generate /etc/clickhouse-server
unset CLICKHOUSE_PASSWORD

exec /entrypoint.sh "$@" --config-file=/etc/clickhouse-server/config.xml
