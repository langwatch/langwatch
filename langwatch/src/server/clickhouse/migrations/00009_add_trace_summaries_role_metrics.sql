-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS ScenarioRoleCosts Map(String, Float64),
  ADD COLUMN IF NOT EXISTS ScenarioRoleLatencies Map(String, Float64),
  ADD COLUMN IF NOT EXISTS ScenarioRoleSpans Map(String, String),
  ADD COLUMN IF NOT EXISTS SpanCosts Map(String, Float64);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS ScenarioRoleCosts,
--   DROP COLUMN IF EXISTS ScenarioRoleLatencies,
--   DROP COLUMN IF EXISTS ScenarioRoleSpans;

-- +goose StatementEnd
-- +goose ENVSUB OFF
