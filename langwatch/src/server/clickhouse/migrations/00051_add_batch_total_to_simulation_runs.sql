-- +goose Up
-- +goose ENVSUB ON

-- ADR-061: run aggregates are queries, not pipelines.
--
-- A suite run's progress is a GROUP BY over its simulation runs. Every field
-- of it derives from the children except the denominator — how many runs the
-- batch intended to queue — which only the dispatcher knows.
--
-- Carrying that denominator on each child means it is known from whichever
-- row lands first (no "2 of 2" then "2 of 5" as fan-out completes), it lives
-- in the simulation event log so a replay reproduces it, and a partly
-- dispatched batch reports an honest shortfall instead of hanging below a
-- total it can never reach.
--
-- 0 means unknown: rows written before this column existed. The read path
-- treats 0 as "count the rows", so historical suite runs display their actual
-- child count rather than a zero denominator.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS BatchTotal UInt32 DEFAULT 0;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment the ALTER statement and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS BatchTotal;
-- +goose StatementEnd

-- +goose ENVSUB OFF
