-- +goose Up
-- +goose ENVSUB ON

-- The application version a trace ran on, as a trace_analytics column, so the Release check reads
-- releases from trace_metrics without reading a map (analytics ADR-004): the resource attribute
-- service.version, else metadata.version, else metadata.app_version
-- (specs/lwql/release-check-reads-releases.feature).
--
-- A plain column with a DEFAULT, no MATERIALIZED expression: the traceAnalytics fold writes it, so
-- an older release that writes the row leaves ''. This file starts no mutation and copies no rows.
-- background step: trace:replay-trace-analytics-app-version refolds the last 62 days once no older
-- writer is left.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses the Replicated
-- engine (00001), which propagates DDL to every node on its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS AppVersion String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS AppVersion;
