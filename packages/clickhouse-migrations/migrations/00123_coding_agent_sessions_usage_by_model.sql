-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions: what the session spent on each model, per context.
--
--   UsageByModel: one entry per (working context, model) the session's model
--                 calls ran under, carrying their tokens, computed cost and
--                 AI units, and whether every call on the model was priced.
--                 Unstamped calls sit under the empty context. Bounded,
--                 first seen first.
--
-- The pull-request read takes its per-model breakdown from the per-call fact
-- table, which only logs feed. An agent whose model calls ride spans only
-- (Copilot) never reaches it, so its models read with unknown tokens. This
-- column is that breakdown for such a session, split by context so a session
-- that drove two pull requests gives each only the calls made on its branch
-- (ADR-039 §Extension S7). AI units stay a count here too: they never enter
-- CostUsd. Priced = false shows the model's cost as unknown, never as zero.
--
-- DEFAULT [] for the same reason 00099 gives UsageByContext one: a
-- variable-size column added by ALTER is unmaterialised in every part
-- written before it, and a read of such a part without a default decodes
-- garbage.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD COLUMN IF NOT EXISTS UsageByModel Array(Tuple(String, String, String, String, String, UInt64, UInt64, UInt64, UInt64, Float64, Float64, Bool)) DEFAULT [] CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN, which forgets the per-model
-- split of every folded session. `up` is idempotent (`ADD COLUMN IF NOT
-- EXISTS`), so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP COLUMN IF EXISTS UsageByModel;
