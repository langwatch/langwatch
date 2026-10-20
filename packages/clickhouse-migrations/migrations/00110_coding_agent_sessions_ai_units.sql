-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: the AI units an agent reports per model call.
--
--   AiUnits: sum of the AI units on the session's model calls (Copilot's
--            `nano_aiu`, divided down to whole units) — 0 on rows from before
--            this column, and for agents that report none.
--
-- AI units are what Copilot meters a request in, not a dollar figure: they
-- never enter `CostUsd` or `AgentReportedCostUsd`, and the pull-request cost
-- shows them as their own count (ADR-039 §Extension S7).
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS AiUnits Float64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets the AI units
-- every already-folded session reported. `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS AiUnits;
