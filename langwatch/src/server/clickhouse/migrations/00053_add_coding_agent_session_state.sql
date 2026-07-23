-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions.State — ADR-066.
--
-- The row that migration 00051 created has "two faces": the queryable analytics
-- columns (a LOSSY aggregate — counters, bounded sets, ids that reach the heavy
-- data) AND, from here on, a LOSSLESS resume blob. `State` carries the full
-- JSON-serialized fold state, including the three bookkeeping fields the
-- analytics columns deliberately drop (`subAgentIds`, `previousCallContextTokens`,
-- `metricSeries`).
--
-- Why: the coding-agent session fold's store used to return null from get(),
-- because the analytics row cannot reconstruct fold state. That forced the
-- executor to refold the aggregate's ENTIRE history from event_log on every
-- cache miss and every out-of-order delivery. On a large session (the key falls
-- back to a trace id, so one big trace is one huge aggregate) those refolds are
-- 20-100 MB S3-walking event_log reads; on 2026-07-23 they starved ClickHouse
-- merges into TOO_MANY_PARTS and took the platform down.
--
-- With this column the store reads its OWN last committed state back (a bounded
-- one-row read, fronted by the Redis cache) instead of refolding. The blob must
-- round-trip the working state exactly — that completeness is the whole point.
--
-- ZSTD(3): the blob is repetitive JSON and cold once written; a higher level
-- than the analytics columns' ZSTD(1) pays for itself on a resume-only column.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
    ADD COLUMN IF NOT EXISTS State String DEFAULT '' CODEC(ZSTD(3));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS State;
