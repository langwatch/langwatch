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
-- dedup survives cache loss. Bounded to the in-flight batch.
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
