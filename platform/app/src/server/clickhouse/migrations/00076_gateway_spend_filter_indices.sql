-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Skip indices and a derived metadata map for the gateway_spend read surface.
--
-- gateway_spend is ORDER BY (TenantId, GatewayRequestId) and PARTITION BY
-- toYYYYMM(OccurredAt), with no skip indices at all. The sort prefix answers
-- "this tenant" and "this request id" and nothing else, so every other
-- predicate the spend REST surface offers is a full scan of every candidate
-- partition, under FINAL. That is affordable for one project and is not for an
-- organization running a project per customer, which is the shape this surface
-- is being extended for.
--
-- Each index below covers one filter the surface accepts. Two filters
-- deliberately get none:
--   * Status has four values over a whole table, so a bloom would be
--     consulted on every granule and skip almost none.
--   * TenantId is already the first sort key, so a project filter prunes
--     through the primary index before any skip index is consulted.
--
-- MetadataMap is a MATERIALIZED expression column, not a stored one written by
-- the fold. Verified against the pinned server (25.8): the expression is
-- evaluated for parts written BEFORE this ALTER, so a metadata filter is
-- correct over the full thirteen month window from the moment this lands,
-- with no backfill and no window during which history silently drops out of a
-- filtered reconciliation.
--
-- The rejected alternative is worth recording, because it looks simpler and is
-- a data-loss shape: having the fold write a real Map column and backfilling
-- by re-insert. A backfill row carries a higher EventTimestamp, which is this
-- table's ReplacingMergeTree version, so it would outrank and erase the fold's
-- next legitimate write for that request.
--
-- NOTE ON APPLICATION: ADD INDEX applies only to parts written after it lands,
-- and ADD COLUMN ... MATERIALIZED is evaluated on read for older parts. Both
-- are therefore correct immediately and slower on history until backfilled.
-- The backfill rewrites column and index files across the table and is an ops
-- task, not something this migration runs inline:
--
--   ALTER TABLE <db>.gateway_spend MATERIALIZE COLUMN MetadataMap;
--   ALTER TABLE <db>.gateway_spend MATERIALIZE INDEX idx_gateway_spend_metadata_key;
--   ... one MATERIALIZE INDEX per index below ...
--
-- Until then an unmaterialized index means the granule is read rather than
-- skipped. It never drops a row, so the answer stays right either way.
--
-- bloom_filter(0.001) GRANULARITY 1 mirrors idx_evaluation_id on
-- evaluation_runs: a 0.1% false-positive rate checked at the finest
-- granularity, so a miss costs at most an occasional extra granule read. The
-- map indices use bloom_filter(0.01) GRANULARITY 4 to mirror the
-- mapKeys/mapValues pair stored_spans has carried since 00002, since caller
-- metadata has the same high-cardinality, many-keys-per-row shape as span
-- attributes.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD COLUMN IF NOT EXISTS MetadataMap Map(String, String)
    MATERIALIZED JSONExtract(Metadata, 'Map(String, String)');
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_metadata_key mapKeys(MetadataMap)
    TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_metadata_value mapValues(MetadataMap)
    TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_virtual_key VirtualKeyId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_end_user EndUserId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_principal PrincipalUserId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_model Model
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_provider_key ProviderKey
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_labels Labels
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- RequestType is LowCardinality over a handful of wire shapes, so a set index
-- holding every distinct value per granule prunes whole granules on an
-- equality filter at a fraction of a bloom's size.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend
  ADD INDEX IF NOT EXISTS idx_gateway_spend_request_type RequestType
    TYPE set(16) GRANULARITY 4;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. Down migrations are
-- intentionally commented out per LangWatch CLAUDE.md "ClickHouse
-- migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_request_type;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_labels;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_provider_key;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_model;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_principal;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_end_user;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_virtual_key;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_metadata_value;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP INDEX IF EXISTS idx_gateway_spend_metadata_key;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_spend DROP COLUMN IF EXISTS MetadataMap;
