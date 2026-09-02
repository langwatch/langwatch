-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: the cost the agent reports about itself, beside the
-- computed one.
--
--   AgentReportedCostUsd: sum of the `cost_usd` the agent states on its
--                         api_request events — 0 on rows from before this
--                         column, and for agents that report no cost.
--
-- `CostUsd` becomes the computed figure: the session's own tokens priced
-- against the model registry, the same formula and the same cache-write
-- lifetime the trace pipeline applies to the identical spans, so a session
-- and its traces state one number. What the agent says it was billed moves
-- here. The two are kept side by side because their disagreement is a
-- signal: it caught the registry pricing hour-long cache writes short-lived,
-- and the agent billing a model at a withdrawn price, on the same day.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS AgentReportedCostUsd Float64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets what every
-- already-folded session reported about its own bill. `up` is idempotent
-- (`ADD COLUMN IF NOT EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS AgentReportedCostUsd;
