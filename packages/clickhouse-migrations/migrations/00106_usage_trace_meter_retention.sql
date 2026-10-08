-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Entitlement's trace meter (usage_trace_meter, 00104) keeps thirteen months.
--
-- Retention: deliberately EXEMPT from tenant retention, as gateway_spend
-- (00067) is. The meter is a billing-grade record: limits and invoices count
-- from it, and a customer-shrinkable tenant policy must not govern it. So the
-- fixed 13-month TTL is declared here, and the table stays absent from
-- RETENTION_TABLE_CATEGORY_MAP, INDEFINITE_DEFAULT_RETENTION_TABLES and
-- TABLE_TTL_CONFIG, so the reconciler's whole-clause MODIFY TTL never rewrites
-- it. Pinned by retention-ttl.unit.test.ts.
--
-- Month is the first day of the UTC month a span arrived in, so a month's rows
-- expire thirteen months after that month began; enforcement reads only the
-- current month and the one before it.
--
-- materialize_ttl_after_modify is left at its default, as in 00095: the table
-- is new and small, so recomputing each part's TTL is cheap, and
-- `mutations_sync = 0` keeps the deploy from waiting on it.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.usage_trace_meter
  MODIFY TTL toDateTime(Month) + INTERVAL 13 MONTH DELETE
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: rows past the window are deleted at merge and do not come back.
-- `up` is idempotent, so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.usage_trace_meter REMOVE TTL;
