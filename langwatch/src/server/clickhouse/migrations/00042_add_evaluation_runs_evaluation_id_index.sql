-- +goose Up
-- +goose ENVSUB ON

-- Bloom-filter skip index on evaluation_runs.EvaluationId.
--
-- evaluation_runs is ORDER BY (TenantId, EvaluationId) and
-- PARTITION BY toYearWeek(ScheduledAt). Point lookups by
-- (TenantId, EvaluationId) that carry no ScheduledAt predicate cannot prune
-- partitions, so the primary key lands on one candidate granule in EVERY
-- part and reads it, even when the evaluation lives in a single week.
-- EXPLAIN INDEXES for such a lookup on a large tenant:
--
--   PrimaryKey  Parts: 61/73   Granules: 61/17174
--   (no skip index on EvaluationId)
--   -> reads 61 granules, one per part
--
-- trace_summaries already solves the identical shape with its idx_trace_id
-- bloom filter. The same EXPLAIN there prunes the candidate granules away
-- entirely:
--
--   PrimaryKey    Parts: 180/251  Granules: 180/12828
--   idx_trace_id  Parts: 0/180    Granules: 0/180
--   -> reads nothing
--
-- This index gives evaluation_runs the same property: a granule whose bloom
-- says the EvaluationId is absent is skipped instead of read. It benefits
-- every (TenantId, EvaluationId) point read, including the ScheduledAt
-- resolve that bounds the getByEvaluationId partition scan.
--
-- bloom_filter(0.001) GRANULARITY 1 mirrors the existing idx_trace_id on this
-- same table (a 0.1% false-positive rate checked at the finest granularity),
-- so a miss costs at most an occasional extra granule read.
--
-- NOTE: ADD INDEX only applies to parts written after it lands. Existing parts
-- keep their current behaviour until backfilled with
--   ALTER TABLE <db>.evaluation_runs MATERIALIZE INDEX idx_evaluation_id;
-- which rewrites index files across the table and should be scheduled as an
-- ops task rather than run inline by this migration.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD INDEX IF NOT EXISTS idx_evaluation_id EvaluationId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. Down migrations are
-- intentionally commented out per LangWatch CLAUDE.md "ClickHouse
-- migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP INDEX IF EXISTS idx_evaluation_id;
