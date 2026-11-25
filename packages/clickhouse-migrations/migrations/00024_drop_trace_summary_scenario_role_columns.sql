-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Scenario role cost/latency are no longer accumulated on the trace_summaries
-- fold (that per-span bookkeeping ran for every trace on the platform and made
-- folding O(n^2)). They are now derived from stored_spans when simulation
-- metrics are computed, so these columns are dead and dropped.
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP COLUMN IF EXISTS ScenarioRoleCosts,
  DROP COLUMN IF EXISTS ScenarioRoleLatencies,
  DROP COLUMN IF EXISTS ScenarioRoleSpans,
  DROP COLUMN IF EXISTS SpanCosts;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- To roll back, uncomment and run manually. Re-adds the columns empty; the
-- historical values are not recoverable (they are re-derivable from stored_spans).
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   ADD COLUMN IF NOT EXISTS ScenarioRoleCosts Map(String, Float64),
--   ADD COLUMN IF NOT EXISTS ScenarioRoleLatencies Map(String, Float64),
--   ADD COLUMN IF NOT EXISTS ScenarioRoleSpans Map(String, String),
--   ADD COLUMN IF NOT EXISTS SpanCosts Map(String, Float64);

-- +goose StatementEnd
-- +goose ENVSUB OFF
