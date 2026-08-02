-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions — context-economics columns.
--
-- Four session facts the fold already sees but the row could not carry:
--
--   RateLimitEvents    — rate-limit events the agent REPORTED
--                        (`rate_limit_event` / `rate_limit_info`), kept apart
--                        from the 429-inferred `RateLimited`: the event also
--                        fires on warnings and status updates, so the two
--                        counters answer different questions.
--   CompactionTriggers — compactions by trigger kind (`{"auto": 3,
--                        "manual": 1}`). A session that keeps auto-compacting
--                        is out of headroom; one the user compacts is being
--                        steered. Mirrors the ErrorTypes map pattern.
--   ParentSessionId    — the session that SPAWNED this one, when the agent
--                        stamps lineage. Empty for root sessions and for
--                        agents that emit none.
--   IsFork             — this session FORKED its parent's context (inheriting
--                        the whole window, and its cost) rather than starting
--                        fresh. The expensive spawn mode worth flagging.
--
-- Each ALTER is its own statement block — ClickHouse does not support
-- multi-statement queries.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS RateLimitEvents UInt32 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS CompactionTriggers Map(LowCardinality(String), UInt32) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- Plain String, never LowCardinality: session ids are high-cardinality.
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS ParentSessionId String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS IsFork Bool DEFAULT false CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS RateLimitEvents;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS CompactionTriggers;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS ParentSessionId;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS IsFork;
