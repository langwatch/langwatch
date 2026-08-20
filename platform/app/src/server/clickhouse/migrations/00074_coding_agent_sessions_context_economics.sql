-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: context-economics columns.
--
-- Four session facts the fold already sees but the row could not carry:
--
--   RateLimitEvents:     rate-limit events the agent REPORTED
--                        (`rate_limit_event` / `rate_limit_info`), kept apart
--                        from the 429-inferred `RateLimited`: the event also
--                        fires on warnings and status updates, so the two
--                        counters answer different questions.
--   CompactionTriggers:  compactions by trigger kind (`{"auto": 3,
--                        "manual": 1}`). A session that keeps auto-compacting
--                        is out of headroom; one the user compacts is being
--                        steered. Mirrors the ErrorTypes map pattern.
--   ParentSessionId:     the session that SPAWNED this one, when the agent
--                        stamps lineage.
--   IsFork:              this session FORKED its parent's context (inheriting
--                        the whole window, and its cost) rather than starting
--                        fresh. The expensive spawn mode worth flagging.
--
-- The two lineage columns are plumbing ahead of a wire that does not carry
-- lineage yet: no agent observed to date stamps either key, so they hold
-- their defaults. Empty therefore means "no lineage was reported", NOT
-- "this session has no parent", and nothing should render a spawn tree from
-- them until an agent starts emitting. Sub-agents themselves are still
-- counted, from the distinct `agent_id` on their own signals.
--
-- Each ALTER is its own statement block, because ClickHouse does not support
-- multi-statement queries.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS RateLimitEvents UInt32 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
-- `DEFAULT map()` is not cosmetic. A variable-size column added by ALTER is
-- unmaterialised in every part written before it, so a read decodes a size
-- header that was never written; 00014 and 00057 both fixed that, and 00057
-- records that the same header applies to Map. A read of this column on a
-- pre-00074 session row is exactly that case, and the default makes it
-- synthesise an empty map instead.
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS CompactionTriggers Map(LowCardinality(String), UInt32) DEFAULT map() CODEC(ZSTD(1));
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
-- IRREVERSIBLE: every rollback here is a DROP COLUMN, which destroys the
-- values that column holds for every session already folded, and an automated
-- `goose down` is exactly the way that happens by accident. The statements are
-- written out but left commented, so `down` is deliberately a no-op: re-running
-- `up` is idempotent (`ADD COLUMN IF NOT EXISTS`), and a rollback that has to
-- be pasted by hand is one somebody decided on.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS RateLimitEvents;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS CompactionTriggers;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS ParentSessionId;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS IsFork;
