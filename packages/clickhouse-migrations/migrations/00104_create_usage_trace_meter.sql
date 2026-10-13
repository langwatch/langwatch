-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Entitlement's trace usage (modules/entitlement): one row per trace, project
-- and UTC month. Live rows come from trace's span_received events, one debounced
-- job per trace; the trace module's upgrade step sends this month's trace ids.
-- Writing a trace twice collapses on the key; reads count distinct TraceId with
-- GROUP BY, never FINAL. Keyed by organization, like billable_events (00002).
--
-- Retention: a fixed 13-month TTL, EXEMPT from tenant retention like
-- gateway_spend (00067): limits count from it. It stays out of
-- RETENTION_TABLE_CATEGORY_MAP, INDEFINITE_DEFAULT_RETENTION_TABLES and
-- TABLE_TTL_CONFIG (pinned by retention-ttl.unit.test.ts).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_meter
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    -- The first day of the UTC month the trace was seen in.
    Month Date CODEC(Delta(2), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(Month)
ORDER BY (OrganizationId, Month, TenantId, TraceId)
TTL toDateTime(Month) + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The current month's rows are
-- rebuilt by re-running the trace module's month trace ids step.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_meter;
-- +goose StatementEnd
