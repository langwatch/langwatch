-- +goose Up
-- +goose ENVSUB ON

-- billable_events gets a 13-month delete TTL on EventTimestamp. The usage meter
-- reads only the current and previous billing month, so older rows are dead weight.
-- MODIFY TTL replaces the whole clause: on a tiered table this drops the cold-storage
-- MOVE until the TTL reconciler runs later in the same upgrade and writes back the
-- MOVE together with this DELETE (TABLE_TTL_CONFIG, deleteAfterMonths).
-- materialize_ttl_after_modify = 0 keeps it metadata-only: parts written before this
-- migration learn the rule from the background step below, which materialises it.
-- background step: entitlement:materialise-billable-events-ttl
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.billable_events
  MODIFY TTL toDateTime(EventTimestamp) + INTERVAL 13 MONTH DELETE
  SETTINGS materialize_ttl_after_modify = 0, alter_sync = 1;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE in spirit: rows already deleted by the TTL do not come back.
--
-- To roll back, uncomment and run manually, on an image whose TABLE_TTL_CONFIG has
-- no deleteAfterMonths for billable_events (or this reconciler writes it back).
-- That reconciler then restores the cold-storage MOVE alone on its next run.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.billable_events REMOVE TTL;
