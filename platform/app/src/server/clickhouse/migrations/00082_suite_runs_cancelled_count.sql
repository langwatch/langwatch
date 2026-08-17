-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Cancelled items get their own suite counter (#6834).
--
-- The suite fold previously routed any item status it did not recognise into
-- CompletedCount, so a suite containing cancelled (or stalled) items could
-- finish SUCCESS with the cancellation invisible. Cancelled is neither a
-- completion nor a failure — it needs its own bucket for the fold's terminal
-- status ladder (FAILED > CANCELLED > SUCCESS) and for any reader that wants
-- to show it. DEFAULT 0 keeps historical rows readable unchanged.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
    ADD COLUMN IF NOT EXISTS CancelledCount UInt32 DEFAULT 0 AFTER FailedCount;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- To roll back, uncomment and run manually:
-- -- +goose StatementBegin
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs DROP COLUMN IF EXISTS CancelledCount;
-- -- +goose StatementEnd

-- +goose ENVSUB OFF
