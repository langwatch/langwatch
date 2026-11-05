-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_session_events: the AI units one model call consumed.
--
--   AiUnits: what the call cost in its agent's AI units (Copilot's `nano_aiu`,
--            divided down to whole units). 0 on every row from before this
--            column and on every row of an agent that reports none.
--
-- Copilot sends its model calls on spans only, so its `chat` spans write their
-- own `model_call` rows here, stamped with the working context as log rows
-- are. The pull-request read sums this column per model beside the tokens and
-- cost. AI units are what Copilot meters a request in, not a dollar figure:
-- they never enter `CostUsd` (ADR-039 §Extension S7).
--
-- A fixed-size column, so the DEFAULT covers every part written before it.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events
  ADD COLUMN IF NOT EXISTS AiUnits Float64 DEFAULT 0 CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets the AI units of
-- every model call already written. `up` is idempotent (`ADD COLUMN IF NOT
-- EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_session_events DROP COLUMN IF EXISTS AiUnits;
