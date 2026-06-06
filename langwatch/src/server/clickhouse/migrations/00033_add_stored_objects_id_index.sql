-- +goose Up
-- +goose ENVSUB ON

-- stored_objects is ORDER BY (project_id, id) and PARTITION BY
-- toYYYYMM(created_at). The cross-tenant lookup
-- (stored-objects-cross-tenant-lookup.ts) resolves a stored object by `id`
-- alone — by design it does NOT know the project_id — with
--   SELECT project_id FROM stored_objects WHERE id = {id} LIMIT 1
-- Because `id` is the SECOND sort-key column, that predicate cannot prune via
-- the primary key, so the read falls back to a full scan of every granule in
-- every monthly partition. On the larger ClickHouse instances this lookup was
-- the slowest query in production (~17s for a single point lookup).
--
-- Add a bloom_filter skip-index on `id` (matching the existing idx_sha256 /
-- idx_purpose granularity) so a point lookup by id skips the granule-blocks
-- that cannot contain it, the same way idx_sha256 already accelerates the
-- per-project content-hash lookup.
--
-- This ADD INDEX only attaches the index to NEW parts. To backfill existing
-- parts, the reviewer should run (out of band, it is a heavy mutation that
-- reads the id column across all parts — plan it for a low-traffic window):
--   ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_objects MATERIALIZE INDEX idx_id;

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_objects
  ADD INDEX IF NOT EXISTS idx_id id
    TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually:
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_objects DROP INDEX IF EXISTS idx_id;
