-- +goose Up
-- +goose ENVSUB ON

-- Bloom-filter skip index on simulation_runs.ScenarioRunId.
--
-- Same shape as the evaluation_runs.EvaluationId index (migration 00042):
-- simulation_runs is ORDER BY (TenantId, ScenarioRunId) and
-- PARTITION BY toYearWeek(StartedAt). A point lookup by
-- (TenantId, ScenarioRunId) carries no StartedAt predicate, so it cannot prune
-- partitions. The primary key narrows to a single candidate granule, but it
-- does so in EVERY part, and with no skip index on ScenarioRunId there is
-- nothing to rule those granules out, so all of them are read.
--
-- EXPLAIN INDEXES for such a lookup on two large tenants:
--
--   PrimaryKey   Parts: 109/163   Granules: 109/1414   -> reads 109 granules
--   PrimaryKey   Parts:  56/163   Granules:  56/1414   -> reads 56 granules
--   (no skip index on ScenarioRunId)
--
-- The table already carries blooms on ScenarioId, BatchRunId and
-- ScenarioSetId — the secondary lookup paths — but not on the column its own
-- sort key leads with, which is what the single-run reads filter on.
--
-- bloom_filter(0.001) GRANULARITY 1 mirrors the sibling blooms on this same
-- table, so a false positive costs at most an occasional extra granule read.
--
-- NOTE: ADD INDEX only applies to parts written after it lands. Existing parts
-- keep their current behaviour until backfilled with
--   ALTER TABLE <db>.simulation_runs MATERIALIZE INDEX idx_scenario_run_id;
-- which rewrites index files across the table and should be scheduled as an
-- ops task rather than run inline by this migration.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD INDEX IF NOT EXISTS idx_scenario_run_id ScenarioRunId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. Down migrations are
-- intentionally commented out per LangWatch CLAUDE.md "ClickHouse
-- migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP INDEX IF EXISTS idx_scenario_run_id;
