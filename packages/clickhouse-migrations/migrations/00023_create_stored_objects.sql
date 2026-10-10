-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: stored_objects
-- ============================================================================
-- Stores externalized binary/text content referenced by trace events.
-- id is a deterministic UUID v5 derived from (project_id, sha256) so that
-- identical content uploaded under the same project is deduplicated at write
-- time without a read-before-write.
--
-- Table name is intentionally unqualified — per project convention, migrations
-- run inside the database resolved from the connection string, so qualifying
-- with ${CLICKHOUSE_DATABASE}. is both redundant and incorrect on installs
-- where the env var isn't set. CREATE TABLE IF NOT EXISTS makes this
-- migration idempotent.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stored_objects
(
    id String CODEC(ZSTD(1)),
    project_id String CODEC(ZSTD(1)),
    purpose LowCardinality(String),
    owner_kind LowCardinality(String),
    owner_id String CODEC(ZSTD(1)),
    media_type String CODEC(ZSTD(1)),
    size_bytes UInt64,
    sha256 String CODEC(ZSTD(1)),
    storage_uri String CODEC(ZSTD(1)),
    created_at DateTime64(3),
    inserted_at DateTime64(3) DEFAULT now64(),

    INDEX idx_sha256 sha256 TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_purpose purpose TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}inserted_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, id)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose StatementBegin

-- DROP TABLE IF EXISTS stored_objects SYNC;

-- +goose StatementEnd
