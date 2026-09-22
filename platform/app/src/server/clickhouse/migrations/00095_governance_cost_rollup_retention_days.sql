-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- The two governance cost tables stop expiring on a fixed timer and start
-- carrying their own retention number, defaulting to "keep forever".
--
--   governance_cost_rollup_1d
--   governance_cost_rollup_restatement_index
--
-- Both were created (00092, 00094) with `TTL toDateTime(Day) + INTERVAL
-- 13 MONTH DELETE` hardcoded into the table. That timer is the whole of their
-- retention story today: there is no way to keep a row longer, no way to expire
-- one sooner, and no way to answer a per-tenant or per-source retention
-- question about them without a migration. Thirteen months was also never a
-- derived number — it was borrowed from `gateway_spend` (00067), which borrowed
-- it from the usage-estimate ledgers.
--
-- This migration replaces the timer with the same `_retention_days` mechanism
-- every other TTL-carrying table uses (00032), with ONE difference that is the
-- entire point: the column DEFAULTS TO 0, not to 308.
--
-- 0 is the indefinite sentinel. `buildRetentionTTLExpression` (ttlReconciler)
-- maps it to a year-2106 expiry, so a row stamped 0 is never deleted. Since
-- nothing writes the column — the inserts are JSONEachRow object literals with
-- no explicit column list, so an added column is simply omitted and takes its
-- DEFAULT — every existing and every future row reads 0 and is kept.
--
-- NET BEHAVIOUR CHANGE, stated plainly: the 13-month hard delete stops. Nothing
-- else moves. What is bought is the knob: stamp a non-zero day count on a row
-- (or on a future write path) and that row ages out on the next merge, with no
-- further migration and no change to the reconciler.
--
-- WHY NOT THE CUSTOMER RETENTION MAP. These two tables carry `_retention_days`
-- but are deliberately NOT added to RETENTION_TABLE_CATEGORY_MAP. That map is
-- the CUSTOMER-facing cascade: its categories are traces/scenarios/experiments
-- (money is none of them), `resolveRetention` floors every mapped category to
-- the 49-day platform default (the opposite of the indefinite default this
-- migration installs), and membership is also what enrolls a table in the
-- customer storage meter. They join the separate
-- INDEFINITE_DEFAULT_RETENTION_TABLES list instead, and the reconciler gates on
-- the union of the two (RETENTION_TTL_MANAGED_TABLES). See
-- retentionPolicy.schema.ts.
--
-- SUPERSEDED COMMENTS IN 00092 AND 00094. Both of those migrations contain a
-- "Retention:" paragraph stating that the table is exempt from tenant
-- retention, that a fixed 13-month TTL is declared there, and that the table is
-- absent from TABLE_TTL_CONFIG so the reconciler never rewrites the clause. As
-- of this migration all three of those statements are false: the fixed TTL is
-- replaced below, both tables are now in TABLE_TTL_CONFIG, and the reconciler
-- does maintain their TTL clause. Those files are NOT edited — an applied
-- migration is immutable history, and rewriting the comment would misdescribe
-- what that migration actually did on the day it ran. What remains true from
-- them: both tables still sit outside the customer retention map, and
-- `RawActorId` still carries provider-supplied personal data, so a
-- subject-deletion request must still reach these tables explicitly. It always
-- had to — the 13-month TTL was a holding bound, never an erasure mechanism —
-- but with the default now indefinite there is no timer behind it at all.
--
-- Each statement is its own StatementBegin block: ClickHouse does not support
-- multi-statement queries.
--
-- The ADD COLUMNs are metadata-only — ClickHouse does not scan or rewrite
-- existing parts, and sparse encoding compresses an all-default column to
-- ~zero bytes.
--
-- The MODIFY TTLs deliberately do NOT set `materialize_ttl_after_modify = 0`.
-- The reconciler passes 0 because it re-runs on every boot and only ever
-- re-installs a clause the parts already satisfy. Here the old 13-month bound
-- is recorded in each existing part's own ttl_infos, computed when the part was
-- written; skipping materialization would leave those parts still carrying it
-- and a part could be dropped by a rule this migration exists to remove. The
-- recompute is a mutation over tables that hold at most one row per day per
-- dimension cell and were created only a few migrations ago, so it is cheap;
-- `mutations_sync = 0` keeps the deploy from waiting on it either way.
-- ============================================================================

-- governance_cost_rollup_1d: _retention_days, defaulting to indefinite.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- governance_cost_rollup_restatement_index: same column, same default, so an
-- index row can never outlive — or be outlived by — the cell it points at.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- Replace the fixed 13-month DELETE with the retention expression. This is
-- character-for-character what `buildRetentionTTLExpression` emits for these
-- two TABLE_TTL_CONFIG entries (anchor `toDateTime(Day)`), so the reconciler's
-- first pass after this migration finds the clause already correct — the
-- `_retention_days` substring is exactly what `hasRetentionTTL` looks for — and
-- issues no ALTER of its own.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d
  MODIFY TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index
  MODIFY TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.
--
-- Rolling back is DESTRUCTIVE in a way the `up` is not. Restoring the fixed
-- 13-month TTL re-arms a hard delete over every row older than thirteen months
-- that this migration has been keeping — rows that, after any length of time on
-- the indefinite default, no longer exist anywhere else once the merge runs.
-- Restore the TTL first and the column second, and only after deciding those
-- rows are genuinely disposable.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d MODIFY TTL toDateTime(Day) + INTERVAL 13 MONTH DELETE;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index MODIFY TTL toDateTime(Day) + INTERVAL 13 MONTH DELETE;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index DROP COLUMN IF EXISTS `_retention_days`;
-- +goose StatementEnd
