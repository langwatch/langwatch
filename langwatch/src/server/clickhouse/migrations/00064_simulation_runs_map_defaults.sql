-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- simulation_runs.RoleCosts / RoleLatencies — the last two ALTER-added
-- variable-size columns without a DEFAULT.
--
-- 00057 fixed seven Array columns and explicitly deferred these two: they are
-- Map rather than Array, the 2026-07-28 incident did not implicate them, and a
-- Map default needs its own type-checked literal. The defect is identical.
--
-- `ADD COLUMN` without a DEFAULT (00008) leaves the column unmaterialised in
-- every part written before that ALTER. A Map, like an Array, is stored with a
-- size header; reading a part that never wrote one decodes garbage and
-- ClickHouse allocates whatever it says:
--
--   Code: 173. DB::Exception: Amount of memory requested to allocate is more
--   than allowed: (while reading column <name>) ... max_rows_to_read = 1
--
-- Confirmed still outstanding on 2026-07-29: system.columns reports a blank
-- default_expression for both columns on all three replicas
-- (langwatch-prod-clickhouse-0/1/2), while every column 00057 touched reports
-- `[]` on all three.
--
-- `map()` is the empty-Map literal, the Map analogue of 00057's `[]`. Like
-- those, changing only the DEFAULT is a metadata operation: no part is
-- rewritten, no mutation is scheduled, and reads of a part that lacks the
-- column synthesise the default instead of decoding a header that was never
-- written. Idempotent, so replaying it is a no-op.
--
-- Cluster note: no ON CLUSTER, matching 00057 — when CLICKHOUSE_CLUSTER is set
-- the database uses the Replicated engine (00001), which propagates DDL on its
-- own, and ON CLUSTER against a Replicated database is rejected.
--
-- After this, no ALTER-added Array or Map column in the schema is left without
-- a DEFAULT. Every other undefaulted variable-size column in system.columns
-- (stored_spans.*, metric_*.*, log_records.*, coding_agent_sessions.Steps,
-- trace_analytics.{Attributes,Labels,Models}, ...) comes from its table's
-- original CREATE, so it is materialised in every part and is not this defect.
--
-- The rule for new code, restated from 00057: an Array or Map column added by
-- ALTER MUST carry a DEFAULT. Prefer `DEFAULT []` / `DEFAULT map()` at ADD time
-- over a follow-up migration.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  MODIFY COLUMN RoleCosts Map(String, Array(Float64)) DEFAULT map();
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  MODIFY COLUMN RoleLatencies Map(String, Array(Float64)) DEFAULT map();
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- IRREVERSIBLE: rolling back reinstates the defect. Dropping the DEFAULT puts
-- parts written before 00008 back to decoding a size header that was never
-- written, which is the read-time OOM this migration exists to stop. The Down
-- migration is therefore commented out to prevent accidentally reinstating that
-- failure. Dropping the DEFAULT is itself metadata-only and destroys nothing —
-- the cost is paid on the next read of an old part, not on the ALTER. Rolling
-- back is an explicit operational decision: uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs MODIFY COLUMN RoleCosts Map(String, Array(Float64));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs MODIFY COLUMN RoleLatencies Map(String, Array(Float64));
