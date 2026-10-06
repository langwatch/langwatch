-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Usage's trace meter (modules/usage, ARCHITECTURE.md section 3: usage takes
-- the trace count itself). The `usageTraceMeter` map projection writes one row
-- per span_received event; a trace's spans in one month collapse onto one row
-- per (OrganizationId, Month, TenantId, TraceId). Reads deduplicate with
-- GROUP BY rather than FINAL, and count a trace in the month its first span
-- arrived, as main's trace_summaries CreatedAt count does.
--
-- Keyed and routed by organization, like billable_events (00002), so a
-- private-instance customer's rows stay on their own cluster; TenantId is kept
-- in the key so a month can be counted per project. No retention TTL: a
-- billing-grade record, kept like billable_events.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_meter
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    -- The first day of the UTC month the span arrived in.
    Month Date CODEC(Delta(2), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(Month)
ORDER BY (OrganizationId, Month, TenantId, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The rows are rebuildable only
-- by replaying span_received through usage's trace meter projection.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_meter;
-- +goose StatementEnd
