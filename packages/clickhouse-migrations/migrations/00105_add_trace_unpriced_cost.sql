-- +goose Up
-- +goose ENVSUB ON

-- Unpriced cost, recorded when the trace is folded.
--
-- A span whose model no price rule covers (no custom rate, no explicit cost,
-- no catalogue match) costs 0, and a trace total of 0 is stored as NULL. So
-- TotalCost alone cannot tell "free" from "unpriced", and a trace that is
-- partly priced looks complete. The fold now counts those spans and keeps
-- their model names, sorted, on both trace tables.
--
-- No backfill: rows folded before this migration read 0 and [], which means
-- "not recorded", not "fully priced". Readers say so rather than guess.
--
-- Every Array column added by ALTER carries a DEFAULT, see 00057: without one
-- a part written before this migration reads the absent column's size header
-- as garbage.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS UnpricedSpanCount UInt32 DEFAULT 0 CODEC(ZSTD(1))
    AFTER NonBilledCost
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS UnpricedModels Array(LowCardinality(String)) DEFAULT [] CODEC(ZSTD(1))
    AFTER UnpricedSpanCount
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS UnpricedSpanCount UInt32 DEFAULT 0 CODEC(ZSTD(1))
    AFTER NonBilledCost
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS UnpricedModels Array(LowCardinality(String)) DEFAULT [] CODEC(ZSTD(1))
    AFTER UnpricedSpanCount
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS UnpricedModels;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS UnpricedSpanCount;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS UnpricedModels;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS UnpricedSpanCount;
