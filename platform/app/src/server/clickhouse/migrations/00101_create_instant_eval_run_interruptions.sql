-- +goose Up
-- +goose ENVSUB ON

-- Independent, append-only evidence of actual refused processing operations.
-- A run's projection cannot overwrite this history. Contains identifiers only,
-- never task text, statements, parameters or judgments. Like instant_eval_runs,
-- default retention is indefinite and this table is outside the customer trace
-- retention cascade/storage meter and is not exposed through LangWatchQL.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_run_interruptions
(
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    ComponentType LowCardinality(String) CODEC(ZSTD(1)),
    ComponentName LowCardinality(String) CODEC(ZSTD(1)),
    OperationKey String CODEC(ZSTD(1)),
    ObservedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
ORDER BY (TenantId, RunId, ComponentType, ComponentName, OperationKey)
TTL IF(_retention_days > 0, toDateTime(ObservedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are intentionally commented out to prevent data loss.
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.instant_eval_run_interruptions;
