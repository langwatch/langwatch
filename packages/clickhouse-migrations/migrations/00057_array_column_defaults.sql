-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Every Array column added by ALTER gets an explicit DEFAULT.
--
-- An `ADD COLUMN` without a DEFAULT leaves the column unmaterialised in every
-- part written before the ALTER. For an Array the absent column's size header
-- is read as garbage, and ClickHouse tries to allocate whatever that garbage
-- says — surfacing as, at read time:
--
--   Code: 173. DB::Exception: Amount of memory requested to allocate is more
--   than allowed: (while reading column <name>) ... max_rows_to_read = 1
--
-- and at merge time as Code 241 with a multi-GiB chunk request. The read
-- failure throws out of the fold's read-back, fails the job, and GroupQueue
-- retries it until the aggregate's group wedges.
--
-- This is the second occurrence. 00014 already diagnosed and fixed it for
-- trace_summaries.AnnotationIds, with the same error string in its comment;
-- 00053/00054/00056 then reintroduced it on three more tables. Every scalar
-- column those migrations added carries a DEFAULT — only the Array ones do
-- not, which is why it went unnoticed.
--
-- Changing only the DEFAULT is a metadata operation: no part is rewritten and
-- no mutation is scheduled. Reads of a part that lacks the column synthesise
-- the default instead of decoding a header that was never written.
--
-- These MODIFYs are idempotent — replaying one that is already applied is a
-- no-op — which matters because all seven were applied by hand during the
-- 2026-07-28 incident, ahead of this migration.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own; ON CLUSTER against a Replicated database is rejected.
--
-- Scope — these seven are every ALTER-added Array column that still exists:
--
--   trace_summaries.AnnotationIds (00013) was the first occurrence, and is
--     already fixed by 00014.
--   trace_summaries.`Events.*` (00019) is the same defect, but 00025 DROPped
--     all four columns, so there is nothing left to modify. MODIFY COLUMN has
--     no IF EXISTS escape, so naming a dropped column fails the whole
--     migration. The surviving `Events.*` columns are on stored_spans, where
--     they come from the original CREATE (00002) and so are materialised in
--     every part — not this defect.
--   simulation_runs.RoleCosts / RoleLatencies (00008) are Map, not Array. The
--     same variable-size header applies, but the incident did not implicate
--     them and a Map default needs its own type-checked literal; tracked
--     separately rather than folded into an incident fix.
--
-- The corresponding rule for new code: an Array column added by ALTER MUST
-- carry a DEFAULT. Prefer `DEFAULT []` at ADD time over a follow-up migration.
-- ============================================================================

-- --- trace_analytics (added by 00056) ---------------------------------------

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  MODIFY COLUMN AnnotationIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  MODIFY COLUMN AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- --- evaluation_analytics (added by 00056) ----------------------------------

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics
  MODIFY COLUMN AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- --- coding_agent_sessions (added by 00053 and 00054) -----------------------

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MODIFY COLUMN AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MODIFY COLUMN SubAgentIds Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MODIFY COLUMN StepStartedAt Array(UInt64) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MODIFY COLUMN MetricSeries
    Array(Tuple(String, String, String, String, String, Float64))
    DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- IRREVERSIBLE: rolling back reinstates the defect. Dropping the DEFAULT puts
-- parts written before the original ADD COLUMN back to decoding a size header
-- that was never written, which is the read-time OOM this migration exists to
-- stop. The Down migration is therefore commented out to prevent accidental
-- data loss. To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics       MODIFY COLUMN AnnotationIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics       MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics  MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN SubAgentIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN StepStartedAt Array(UInt64) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN MetricSeries Array(Tuple(String, String, String, String, String, Float64)) CODEC(ZSTD(1));
