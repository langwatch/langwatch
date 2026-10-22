-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: what the session fold remembers of the previous model
-- call, so it can tell a cache rebuild from the context growing.
--
--   PreviousCallCachedTokens — what the previous call left in the cache (its
--                              cache read plus its cache write). A call is a
--                              rebuild only when its cache read fell below
--                              this; a large write on top of a full read is
--                              growth (specs/coding-agent/trace-fidelity.feature).
--   PreviousCallStartedAtMs  — when the previous call started. A call that
--                              started earlier arrived late and is not judged
--                              against a call that came after it.
--
-- Both are read-back state only (ADR-066), never analytics columns. Rows from
-- before this migration read 0, which judges nothing for one call.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS PreviousCallCachedTokens UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS PreviousCallStartedAtMs UInt64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets the bookkeeping
-- every already-folded session holds. `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS PreviousCallCachedTokens;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS PreviousCallStartedAtMs;
