-- +goose Up
-- +goose ENVSUB ON

-- The KSUID byte layout each row's ProjectionId was written in (#9575): "v2"
-- (big-endian timestamp) or "v1-legacy" (the layout @langwatch/ksuid wrote up to
-- 2.0.2). NULL reads as "v1-legacy": every row written before this file, and any
-- row an older release writes after a rollback, since it never sets the column.
--
-- trace_summaries is a fold: a trace already stored derives its id with the
-- layout its row records, so no stored id changes. stored_spans dedups on
-- (TenantId, TraceId, SpanId), never on the id, so new spans record "v2".
--
-- No backfill: NULL already means what every existing row is.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS IdLayout LowCardinality(Nullable(String)) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS IdLayout LowCardinality(Nullable(String)) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans DROP COLUMN IF EXISTS IdLayout;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS IdLayout;
