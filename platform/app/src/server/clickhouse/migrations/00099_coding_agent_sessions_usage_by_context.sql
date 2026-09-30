-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: what the session spent under each declared context.
--
--   UsageByContext: one entry per working context (repository host, owner,
--                   name and branch) the session's model calls were stamped
--                   with, carrying the tokens and computed cost of every call
--                   stamped that way. Bounded, first seen first.
--
-- The cumulative token and cost columns stay the amount a session spent;
-- this column says where it went. The pull-request usage read splits a
-- session across the pull requests it drove by this record, so a long-lived
-- session that declares a new branch per pull request contributes to each
-- one only what it spent there. The per-call fact table used to be the only
-- record of that, and it never sees an agent whose tokens ride spans (codex),
-- whose sessions were therefore charged whole to one pull request.
--
-- A row folded before this column carries the DEFAULT [], which the read
-- prices as usage from before the session declared anything.
--
-- DEFAULT [] for the same reason 00077 gives GitBranches one: a variable-size
-- column added by ALTER is unmaterialised in every part written before it,
-- and a read of such a part without a default decodes garbage (Code 173 at
-- read time, Code 241 at merge time).
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS UsageByContext Array(Tuple(String, String, String, String, UInt64, UInt64, UInt64, UInt64, Float64)) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets where every
-- folded session spent its tokens. `up` is idempotent (`ADD COLUMN IF NOT
-- EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS UsageByContext;
