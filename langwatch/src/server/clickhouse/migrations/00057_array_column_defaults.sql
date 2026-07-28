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
-- no-op — which matters because the first seven were applied by hand during
-- the 2026-07-28 incident, ahead of this migration.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own; ON CLUSTER against a Replicated database is rejected.
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

-- --- trace_summaries Events.* (added by 00019) ------------------------------
--
-- Same defect, already surfacing on this table as
--   ATTEMPT_TO_READ_AFTER_EOF: (while reading column Events.Attributes)
-- rather than as an allocation failure — the header decodes to a length that
-- runs off the end of the stream instead of to an absurd one.
--
-- These are Nested subcolumns, so all four must stay the same length; an empty
-- default on each keeps that invariant on a part that carries none of them.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN `Events.SpanId` Array(String) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN `Events.Timestamp` Array(DateTime64(3)) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN `Events.Name` Array(LowCardinality(String)) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN `Events.Attributes`
    Array(Map(LowCardinality(String), String)) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- Rolling back reinstates the defect: it drops the DEFAULT, so parts written
-- before the original ADD COLUMN decode an unwritten size header again.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics       MODIFY COLUMN AnnotationIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics       MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics  MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN AppliedEventIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN SubAgentIds Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN StepStartedAt Array(UInt64) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions MODIFY COLUMN MetricSeries Array(Tuple(String, String, String, String, String, Float64)) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries       MODIFY COLUMN `Events.SpanId` Array(String) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries       MODIFY COLUMN `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries       MODIFY COLUMN `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries       MODIFY COLUMN `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1));
