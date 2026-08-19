-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- lwql_api_key_tenant_map — maps a SHA-256 hash of a project's LangWatchQL
-- API key (`Project.lwqlKey`) to the tenant id the key authenticates.
--
-- This is the table the SaaS access model's row filters already reference on
-- the 8 LangWatchQL source tables and the ClickHouse settings profile's
-- `custom_api_key_hash` tenant setting resolves through — both provisioned by
-- infra out of band (terraform/XML). Without this table those filters have
-- nothing to join against and every LangWatchQL query reads zero rows. The
-- table name is a literal, hard-coded match for what the infra-managed row
-- filter subqueries already expect; it cannot be derived or renamed here.
--
-- Deliberately a plain table, not a ClickHouse dictionary: a dictionary can be
-- queried directly and bypasses row policies entirely, which would turn this
-- mapping into a cross-tenant oracle. A restricted LangWatchQL identity is
-- never granted anything beyond SELECT on its own row-filtered view of this
-- table (see ../analytics/lwql/provisioning.ts).
--
-- Uniqueness is enforced at READ time, not by this table or its engine: a
-- row filter checks `HAVING uniqExact(TenantId) = 1` for the hash in scope,
-- so a duplicate (KeyHash, TenantId) pair is harmless and a KeyHash mapped to
-- two DIFFERENT tenants fails closed (zero rows) rather than leaking either
-- one. `ORDER BY KeyHash` is sized for that lookup, not for uniqueness.
--
-- This migration creates the empty table only. Rows are written by the
-- deploy-time provisioning task (src/tasks/provisionLwql.ts), which backfills
-- one row per project from `Project.lwqlKey` and keeps new projects in sync —
-- never by migration, since the source of truth for the mapping is Postgres
-- (`Project.id` / `Project.lwqlKey`), not a static seed.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.lwql_api_key_tenant_map
(
    KeyHash String,
    TenantId String
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
ORDER BY KeyHash
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.lwql_api_key_tenant_map;
-- +goose StatementEnd

-- +goose ENVSUB OFF
