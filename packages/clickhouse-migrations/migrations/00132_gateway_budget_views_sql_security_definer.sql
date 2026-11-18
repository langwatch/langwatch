-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- ADR-202 Decided 16: the two views the gateway ledger feeds run as their
-- definer, so the api's insert-only `langwatch_app_writer` fills them. A view
-- with no SQL SECURITY checks the inserter's SELECT on the ledger and refuses
-- the push with 497 after the source row is stored.
--
-- `DEFINER = CURRENT_USER` resolves to the user goose runs as on each target
-- (`pnpm task upgrade` walks the shared target and every routed one), so no
-- name is written here. Every insert into the ledger then depends on that user:
-- dropping or renaming it fails each insert loudly. The operator note is the
-- chart README's "bring your own ClickHouse" rows.
--
-- Not a change to the view's query or columns, so the previous image reads and
-- writes the same rows; re-running sets the same value.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv
  MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index_mv
  MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE in effect: going back to INVOKER makes every writer insert into
-- the ledger fail while pushing to the views. `up` is idempotent.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv MODIFY SQL SECURITY INVOKER;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index_mv MODIFY SQL SECURITY INVOKER;
