-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Entitlement's trace count (modules/entitlement): one row per project per
-- UTC month, folded from trace's facts (`lw.trace.trace_first_seen` once per
-- trace, `lw.trace.traces_counted_before_cut` once per project at upgrade).
-- Replaces usage_trace_meter (00104) as the trace limit's count; that table is
-- no longer written and is retired by a later contract.
--
-- Keyed and routed by organization, like usage_trace_meter, so a private
-- instance's rows stay on their own cluster. Every fold write is a new row;
-- reads take argMax(..., UpdatedAt) per (OrganizationId, Month, TenantId).
-- Retention: a fixed 13-month TTL, exempt from tenant retention like 00106.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_count
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    -- The first day of the UTC month the traces were first seen in.
    Month Date CODEC(Delta(2), ZSTD(1)),
    -- Seeded base plus first sightings since its cut: what the limit reads.
    Traces UInt64 CODEC(ZSTD(1)),
    -- The fold's state as JSON, read back by the next fold of this month.
    FoldState String CODEC(ZSTD(1)),
    AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1)),
    ProjectionVersion LowCardinality(String) CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(Month)
ORDER BY (OrganizationId, Month, TenantId)
TTL toDateTime(Month) + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The rows are rebuilt by
-- replaying trace's first-seen and counted-before-cut facts through the fold.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.usage_trace_count;
-- +goose StatementEnd
