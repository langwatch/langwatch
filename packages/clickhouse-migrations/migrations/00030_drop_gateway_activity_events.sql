-- +goose Up
-- +goose ENVSUB ON
--
-- Unified-trace branch correction (rchaves + master_orchestrator
-- directive 2026-04-27): drop the parallel governance-event storage.
-- Governance ingestion now folds into the existing trace pipeline
-- (recorded_spans + log_records + trace_summaries) with origin
-- metadata distinguishing ingestion-source data; the parallel
-- gateway_activity_events table created in 00019 was the wrong
-- direction.
--
-- Anomaly KPI rollups + /governance dashboard reads will land as a
-- governance fold projection on top of the unified store in a
-- follow-up commit. No data preservation needed — pre-cutover data
-- was dogfood-only (no production customers were ever pointed at
-- the parallel pipeline).

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_activity_events;
-- +goose StatementEnd

-- +goose Down
-- Down migration intentionally not provided — to revert the unified-
-- trace correction we'd need to recreate the parallel pipeline AND
-- replay events from the unified store, which is unsupported. Don't
-- roll back.
