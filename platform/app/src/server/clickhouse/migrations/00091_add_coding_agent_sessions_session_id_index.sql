-- +goose Up
-- +goose ENVSUB ON

-- Bloom-filter skip index on coding_agent_sessions.SessionId.
--
-- coding_agent_sessions is ORDER BY (TenantId, StartedAt, SessionId) and
-- PARTITION BY toYearWeek(StartedAt). The sort key is TIME-LEADING by design:
-- the reads this table exists for are time-bounded scans of a project's
-- sessions, and those prune correctly.
--
-- The single-session point read does not. Its dedup subquery is deliberately
-- unwindowed, and must stay that way: bounding StartedAt inside a dedup scope
-- would let a session whose latest version's StartedAt drifted outside the
-- window read back as a stale older version, which is a non-null result no
-- fallback catches (ADR-071). With StartedAt unconstrained, SessionId sits
-- behind an unbounded second key position, so the primary index cannot exclude
-- a granule on it, and there is no skip index to do so instead.
--
-- EXPLAIN PLAN indexes = 1 for a NONEXISTENT SessionId on a large tenant, so
-- every granule reported is pure waste:
--
--   PrimaryKey  Parts: 8/14   Granules: 8/26
--   (no skip index on SessionId)
--   -> reads 8 granules looking for a session that does not exist
--
-- stored_spans solves the identical shape with idx_trace_id, which prunes the
-- candidate granules away entirely:
--
--   PrimaryKey    Parts: 151/235  Granules: 151/160323
--   idx_trace_id  Parts: 0/151    Granules: 0/151
--   -> reads nothing
--
-- The cost today is small because the table is small. The shape is the point:
-- granules read grow with the tenant's session history rather than with the
-- session being read, and every point read pays it, including the fold's own
-- read-back.
--
-- bloom_filter(0.001) GRANULARITY 1 mirrors idx_trace_id on stored_spans and
-- idx_evaluation_id on evaluation_runs: a 0.1% false-positive rate checked at
-- the finest granularity, so a miss costs at most an occasional extra granule.
--
-- This index changes no results. The subquery stays unwindowed and keeps its
-- correctness property; it simply stops reading granules that cannot contain
-- the session.
--
-- SUPERSEDES a line in migration 00051, which cannot be edited once merged.
-- Its header says of the sort key: "the drawer's single-session read is a cheap
-- seek within one partition. Always filter StartedAt". That holds for the reads
-- that CAN filter StartedAt, and they should. It does not hold for the dedup
-- subquery, which must not filter it, and which this index exists to serve. The
-- same correction is on `findLatestRecord` in
-- coding-agent-session.clickhouse.repository.ts, where the subquery is built.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  ADD INDEX IF NOT EXISTS idx_session_id SessionId
    TYPE bloom_filter(0.001) GRANULARITY 1;
-- +goose StatementEnd

-- ADD INDEX only applies to parts written after it lands, so without the
-- statement below the index is inert on every existing part.
--
-- The two precedents for this shape, migrations 00062 and 00063, left the
-- backfill to an ops task (#5864). A month after they merged, neither had run.
-- EXPLAIN for a nonexistent id still shows both indexes reading most of the
-- granules the primary key hands them:
--
--   evaluation_runs.idx_evaluation_id    63 granules -> 43
--   simulation_runs.idx_scenario_run_id  97 granules -> 80
--   stored_spans.idx_trace_id (backfilled)  151 granules -> 0
--
-- So the deferral is not a postponement of the benefit, it is the loss of it.
-- This migration materialises inline instead, because coding_agent_sessions is
-- currently 26 granules across 14 parts for a large tenant: the rewrite is
-- close to free now and there is no later moment when it will be cheaper. If
-- this table were stored_spans-sized the trade would go the other way and the
-- ops-task route would be right.
--
-- MUTATION_SYNC = 0 so the migration does not block on the rewrite; at this
-- size it completes in the background almost immediately.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions
  MATERIALIZE INDEX idx_session_id SETTINGS mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. Down migrations are
-- intentionally commented out per LangWatch CLAUDE.md "ClickHouse
-- migration" guidance.

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.coding_agent_sessions DROP INDEX IF EXISTS idx_session_id;
