-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Migration: Drop evaluation_states
-- ============================================================================
-- The evaluation_states table had a semantic bug: EvaluationId was set to the
-- evaluator/monitor definition ID, not a unique per-execution ID. This caused
-- ReplacingMergeTree to overwrite results across executions of the same
-- evaluator. Drop and recreate (in 00017) to clear stale data.
-- Also renamed: evaluation_states → evaluation_runs.
-- ============================================================================

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_states SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- No down migration: the previous data was semantically incorrect.
-- To restore, replay events against the old schema.

-- +goose StatementEnd
-- +goose ENVSUB OFF
