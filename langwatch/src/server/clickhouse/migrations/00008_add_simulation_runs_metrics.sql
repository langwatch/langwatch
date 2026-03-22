-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS TotalCost Nullable(Float64),
  ADD COLUMN IF NOT EXISTS RoleCosts Map(String, Float64),
  ADD COLUMN IF NOT EXISTS RoleLatencies Map(String, Float64),
  ADD COLUMN IF NOT EXISTS TraceMetricsJson String DEFAULT '';
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD INDEX IF NOT EXISTS idx_trace_ids TraceIds TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  DROP COLUMN IF EXISTS TotalCost,
  DROP COLUMN IF EXISTS RoleCosts,
  DROP COLUMN IF EXISTS RoleLatencies,
  DROP COLUMN IF EXISTS TraceMetricsJson;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  DROP INDEX IF EXISTS idx_trace_ids;
-- +goose StatementEnd
-- +goose ENVSUB OFF
