-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions — durable dedup watermark (ADR-066, sequencing step 4).
--
-- Queue delivery is at-least-once. The applied-event-id set that lets a fold
-- recognise a redelivered batch lived only in the Redis cache entry, so a
-- committed write followed by a lost cache (TTL, eviction, restart) let a retry
-- re-fold the same batch onto state that already contained it — a silent
-- double-count. This column rides that set next to the state row so redelivery
-- dedup survives cache loss. Bounded to the in-flight batch — the fold declares
-- an explicit coalesceMaxBatch (128) so a single row's watermark stays a few KB,
-- because a ReplacingMergeTree keeps every superseded row version until TTL and
-- each carries its own copy.
--
-- Part of the same read-back row shape as migration 00053, so the same version
-- gate covers it: a row written before this column exists reads back an empty
-- set, and an empty watermark is indistinguishable from "nothing applied yet".
-- Such a row is declined wholesale by projection version rather than decoded —
-- see the version-gate section of 00053's header for the full argument.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS AppliedEventIds Array(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS AppliedEventIds;
