-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Create Database
-- ============================================================================
--
-- Does not drop the database on down, nor does it clean it on up. This is by
-- design, to avoid catastrophic data loss.
--
-- When CLICKHOUSE_REPLICATED=true, uses the Replicated database engine which:
-- - Automatically replicates DDL (CREATE/ALTER/DROP) to all cluster nodes
-- - Eliminates the need for ON CLUSTER in every DDL statement
-- - Ensures goose_db_version table is replicated for consistent migration state
--
-- Note: Data replication still requires ReplicatedMergeTree tables (see other migrations)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE} ${CLICKHOUSE_DATABASE_ENGINE:-};

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- +goose StatementEnd
-- +goose ENVSUB OFF
