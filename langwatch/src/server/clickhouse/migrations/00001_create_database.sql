-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Create Database
-- ============================================================================
--
-- Does not drop the database on down, nor does it clean it on up. This is by
-- design, to avoid catastrophic data loss.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE};

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- +goose StatementEnd
-- +goose ENVSUB OFF
