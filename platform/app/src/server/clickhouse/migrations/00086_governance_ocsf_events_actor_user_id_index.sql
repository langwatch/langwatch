-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Skip index on governance_ocsf_events.ActorUserId — the provider's own id for
-- the person who acted (ADR-094).
--
-- The column has existed since 00026 and was written as the empty string until
-- now; the pull worker populates it from this release, so it becomes the join
-- key between pulled usage and the login-to-person link list.
--
-- WHAT THIS INDEX IS FOR, precisely: per-person DRILL-DOWN — "show me this
-- login's rows" — where one value is being sought inside a window. It does
-- NOT serve the cost report's group-by. The table is ORDER BY (TenantId,
-- EventId), so summing an organization's window reads the whole window
-- whatever indices exist; a bloom filter cannot skip granules for a query that
-- wants every granule. ADR-094 Decision 2 names the follow-up if that summing
-- ever gets slow for a heavy-usage organization — a rollup keyed by login id,
-- a second ClickHouse change to be priced then, not smuggled in here.
--
-- bloom_filter(0.01) GRANULARITY 4 mirrors idx_actor_email in 00026: the two
-- columns are the same shape (one high-cardinality actor identifier per row),
-- sought the same way, so a different tuning would be an unexplained
-- difference rather than a considered one.
--
-- NOTE ON APPLICATION: ADD INDEX applies only to parts written after it lands.
-- History stays correct — an unindexed granule is read rather than skipped, so
-- no row is ever dropped — just not accelerated. Backfilling is an ops task,
-- not something this migration runs inline, because it rewrites index files
-- across every partition including the S3-tiered ones:
--
--   ALTER TABLE <db>.governance_ocsf_events MATERIALIZE INDEX idx_actor_user_id;
--
-- There is little history to accelerate in any case: every row written before
-- this release carries the empty string.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_ocsf_events
  ADD INDEX IF NOT EXISTS idx_actor_user_id ActorUserId
    TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose Down
-- Down migration intentionally not provided. Dropping the index is safe for
-- correctness but is operator-only: it is a fleet-wide ALTER, and a rollback
-- that quietly de-optimizes a live drill-down surface should be a decision
-- somebody makes, not one a deploy makes for them. To roll back: uncomment and
-- run manually.
--
-- -- +goose StatementBegin
-- -- ALTER TABLE ${CLICKHOUSE_DATABASE}.governance_ocsf_events
-- --   DROP INDEX IF EXISTS idx_actor_user_id;
-- -- +goose StatementEnd
