-- +goose Up
-- +goose ENVSUB ON

-- The KSUID byte layout each row's ProjectionId (and LastProcessedEventId) was
-- written in (#9575): "v2" (big-endian timestamp) or "v1-legacy" (the layout
-- @langwatch/ksuid wrote up to 2.0.2). NULL reads as "v1-legacy": every row
-- written before this file, and any row an older release writes after a
-- rollback, since it never sets the column. evaluation_runs is a fold: a run
-- already stored derives its id with the layout its row records, so no stored
-- id changes; a run never stored records "v2".
--
-- No backfill: NULL already means what every existing row is.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS IdLayout LowCardinality(Nullable(String)) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS IdLayout;
