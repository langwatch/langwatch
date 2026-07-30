-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Two columns the rewritten pipelines write and no migration ever added, so
-- every insert to either table failed with "no such column": the client sends
-- JSONCompactEachRow with input_format_skip_unknown_fields: 0, which rejects
-- the whole batch rather than dropping the column.
--
-- Additive only. Neither table's PARTITION BY, ORDER BY or engine version
-- changes, and neither column takes a structural role — metric_time_rollups
-- still partitions and expires on BucketStart (00049), simulation_runs on
-- StartedAt (00002). The ADR-099 re-keys those two tables need are unaffected
-- and unattempted here.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses
-- the Replicated engine (00001), which propagates DDL on its own; ON CLUSTER
-- against a Replicated database is rejected.
-- ============================================================================

-- metric_time_rollups.AcceptedAt — the earliest acceptance across the points a
-- bucket was rebuilt from. Receipt time only moves forward, so recomputing the
-- same bucket later derives the same value. DEFAULT 0 per 00057's rule: a row
-- written before this column existed means "not recorded".
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.metric_time_rollups
  ADD COLUMN IF NOT EXISTS AcceptedAt DateTime64(3) DEFAULT 0 CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- simulation_runs.MetricsAsOf — the observation time the stored role metrics
-- carried. The fold compares an arriving measurement against it and drops the
-- older one; without the column the comparison reads NULL on every read-back
-- and a late old measurement silently wins.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS MetricsAsOf Nullable(DateTime64(3)) DEFAULT NULL CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- Down migrations are commented out to prevent accidental data loss. Dropping
-- MetricsAsOf strands the metrics LWW stamp on every row written since, and the
-- fold reads it back rather than re-deriving it. To roll back, uncomment and
-- run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS MetricsAsOf;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.metric_time_rollups DROP COLUMN IF EXISTS AcceptedAt;
-- +goose ENVSUB OFF
