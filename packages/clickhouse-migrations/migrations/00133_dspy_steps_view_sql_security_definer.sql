-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- ADR-202 Decided 16: the id-index view `dspy_steps` feeds runs as its definer,
-- so the api's insert-only `langwatch_app_writer` fills it from
-- `POST /api/dspy/log_steps`. A view with no SQL SECURITY checks the inserter's
-- SELECT on dspy_steps and refuses the push with 497 after the step is stored.
--
-- `DEFINER = CURRENT_USER` resolves to the user goose runs as on each target,
-- so no name is written here; dropping or renaming that user fails every
-- dspy_steps insert loudly. A separate file from 00132 because each migration
-- touches one owner's tables.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps_id_index_mv
  MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE in effect: going back to INVOKER makes every writer insert into
-- dspy_steps fail while pushing to the view. `up` is idempotent.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps_id_index_mv MODIFY SQL SECURITY INVOKER;
