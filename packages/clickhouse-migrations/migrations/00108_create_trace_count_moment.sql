-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Trace's trace-count moment (modules/trace): one row for the whole
-- deployment, the moment trace's upgrade step counts traces up to. Written
-- before the step counts; trace's new-trace subscriber reads it and sends a
-- `lw.trace.trace_first_seen` event only for traces first seen at or after it.
-- Before it is written, nothing is sent: the step counts those traces.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_count_moment
(
    Id LowCardinality(String) CODEC(ZSTD(1)),
    -- Epoch milliseconds; the earliest stored row is the one readers use.
    CountedUntilMs UInt64 CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
ORDER BY (Id, CountedUntilMs)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_count_moment;
-- +goose StatementEnd
