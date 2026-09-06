-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- session_metric_series — ADR-056 §5.
--
-- One row per CONVERGED metric unit of a coding-agent session. Coding-agent
-- metrics carry no trace context at all (no exemplars in the OTel Rust/JS
-- SDKs) — `session.id` is their only handle — and they are the sole source of
-- lines-of-code, commits, PRs, edit decisions and active time. This table is
-- how a metric-only session exists.
--
-- THE IDEMPOTENCY RULE (the reason this is Replacing, not Summing):
--   Delta counters + an accumulating engine double-count on replay, and this
--   substrate replays. So the projection stores CONVERGED values and
--   re-writes them — it never increments on insert:
--     * a CUMULATIVE point already carries its series' total → the unit is
--       the series, and a later observation REPLACES it (version = AsOf);
--     * a DELTA point must sum exactly once → the unit is the point itself,
--       a re-delivery replaces that one row, and the read-side SUM adds them.
--   The per-session read is `SUM(Value) ... GROUP BY MetricName` across the
--   deduplicated units — the IN-tuple pattern (max(AsOf) per unit), never
--   FINAL, never SummingMergeTree over raw points.
--
-- ORDER BY (TenantId, SessionId, SeriesId): the one read is a per-session
-- seek. AsOf partitions monthly so units age out with their telemetry;
-- filter it when a time range is known.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.session_metric_series
(
    TenantId String CODEC(ZSTD(1)),
    -- The session key (`session.id` — identical value across signals).
    SessionId String CODEC(ZSTD(1)),
    -- The converged unit: a series hash (cumulative) or a point hash (delta).
    SeriesId String CODEC(ZSTD(1)),

    MetricName LowCardinality(String) CODEC(ZSTD(1)),
    MetricUnit LowCardinality(String) CODEC(ZSTD(1)),
    Agent LowCardinality(String) CODEC(ZSTD(1)),
    -- The unit's identity attributes (`type`, `decision`, `language`,
    -- `model`, `tool_name`, `user.id`, …) — low-cardinality by construction:
    -- only recognised coding-agent metric names reach this table.
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- The unit's converged value. REPLACED on re-observation, never added.
    Value Float64 CODEC(ZSTD(1)),
    DataPointCount UInt32 CODEC(ZSTD(1)),

    -- Observation time of the newest folded point — the LWW version column,
    -- so a late re-delivery of an OLD observation cannot overwrite a newer
    -- converged value (arrival order is not observation order).
    AsOf DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}AsOf)
PARTITION BY toYYYYMM(AsOf)
ORDER BY (TenantId, SessionId, SeriesId)
TTL IF(_retention_days > 0, toDateTime(AsOf) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.session_metric_series;
