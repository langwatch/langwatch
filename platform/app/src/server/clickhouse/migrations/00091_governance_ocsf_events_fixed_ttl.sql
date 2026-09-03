-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- governance_ocsf_events: a fixed thirteen-month holding period (ADR-128 §16).
--
-- The table shipped in 00026 declaring no TTL at all, so its rows are kept
-- forever. Four shipped pullers write provider display names, user principal
-- names and email addresses into `ActorEmail` and into the `RawOcsfJson`
-- payload, which makes "forever" the wrong answer for this table specifically.
--
-- Thirteen months, and FIXED, deliberately. The table stays absent from
-- `RETENTION_TABLE_CATEGORY_MAP` and `TABLE_TTL_CONFIG` — the same shape
-- 00067 (gateway_spend) and 00087 (governance_cost_rollup_1d) already use.
-- Enrolling it in the retention map is ruled out rather than merely skipped:
-- the reconciler's `MODIFY TTL` replaces the whole TTL expression atomically
-- (`ttlReconciler.ts`), so enrolment would overwrite this bound with the
-- tenant's own retention value, and a tenant who sets a longer one would then
-- hold names and email addresses past thirteen months. A holding period for
-- personal data is not a customer setting.
--
-- `toDateTime(EventTime)` because EventTime is DateTime64(3) and ClickHouse
-- rejects DateTime64 directly in TTL arithmetic. It is also the partition key
-- (`toYYYYMM(EventTime)`), so expiry drops whole monthly partitions at the part
-- level rather than mutating rows.
--
-- `materialize_ttl_after_modify = 0` — metadata only, matching what the
-- reconciler issues for every other retention TTL in this schema. The
-- alternative rewrites every existing part in one pass, and this table carries
-- six skip indices whose backing data a retroactive TTL mutation has wedged
-- before. Consequence, stated rather than glossed: the bound binds on each
-- part's next merge instead of immediately. Nothing in the table is near
-- thirteen months old (00026 is weeks old), so there is nothing for an
-- immediate pass to delete anyway.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_ocsf_events
  MODIFY TTL toDateTime(EventTime) + INTERVAL 13 MONTH DELETE
  SETTINGS materialize_ttl_after_modify = 0;
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE in the direction that matters: removing the TTL puts the table
-- back to keeping personal data forever, which is the defect this migration
-- exists to close. `up` is idempotent (MODIFY TTL is a whole-clause replace),
-- so `down` is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_ocsf_events REMOVE TTL;
