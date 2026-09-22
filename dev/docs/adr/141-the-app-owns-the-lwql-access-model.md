# ADR-141: The app owns the LangWatchQL access model — no rendered copy

**Date:** 2026-09-22

**Status:** Accepted

## Context

ADR-101 kept two owners of the LangWatchQL access model (`langwatch_lwql` user, `lwql_restricted` profile, row policies, grants, `lwql_postgres` named collection): a rendered-config copy for chart-managed/SaaS ClickHouse, and the application's SQL DDL for BYO ClickHouse. The rendered copy lived in `infra/clickhouse-serverless/internal/render/lwql.go` and was deployed by SaaS `render-config.sh` and the chart. The app's DDL lived in `platform/app/src/server/analytics/lwql/provisioning/` and ran on every boot.

Keeping two copies in sync was never stable. The rendered copies drifted from the app's catalog — the hand-vendored SaaS copy left roughly 113 of 129 production views returning 503, and the Go manifest needed parity tests just to stay in step with the app's definitions. Two owners of one model is a defect.

## Decision

The application owns the LangWatchQL access model, always, on every distribution (chart-managed, BYO, SaaS). No rendered copy exists. `lwql.enabled` (chart) and the presence of `LWQL_CLICKHOUSE_PASSWORD` (app) are the only switches that control whether LangWatchQL is active. Environment variables `LWQL_SELF_PROVISION` and `LWQL_MANAGE_POSTGRES_READER` are removed.

The ClickHouse server's only LangWatchQL-related config is the admin user's `access_management` and `named_collection_control` grants, plus the `custom_` settings prefix. If a server carries config-defined LangWatchQL entities (users, profiles, row policies, named collections) with the same names as the app will create, the app logs a warning, skips that entity, and continues. Boot never fails on ClickHouse errors 495 (ACCESS_STORAGE_READONLY), 669 (NAMED_COLLECTION_DOESNT_EXIST), 670 (NAMED_COLLECTION_ALREADY_EXISTS) or 671 (NAMED_COLLECTION_IS_IMMUTABLE).

## Rationale / Trade-offs

One owner means one catalog and no parity tests. The catalog is authoritative. BYO ClickHouse must grant the app administrative DDL rights to create these objects — `access_management`, `named_collection_control`, and the `custom_` settings prefix. This requirement is unchanged from ADR-101's BYO path. The PostgreSQL reader role `lwql_ro` is converged by the app on whatever PostgreSQL database the `DATABASE_URL` names, so that role needs CREATE/ALTER ROLE rights during provisioning. If those rights are not available, provisioning degrades to a logged, fail-closed refusal rather than a boot-time crash.

Migration from a rendered copy is not an outage. Operators remove the XML entity from ClickHouse config when convenient, and the next app boot converges the SQL-owned entity to match.

## Consequences

The following files are deleted: `infra/clickhouse-serverless/internal/render/lwql.go`, `lwql_catalog.json`, `lwqlTenantPredicate.sql`, `lwqlKeyMapSelfFilter.sql` and their tests (`lwql_sourcecolumns_test.go`, `lwql_tenantcolumn_test.go`). The TypeScript manifest and predicate parity tests are also removed.

The chart's `clickhouse.lwqlAccessModel` values block and the `clickhouse-serverless` subchart's LWQL environment variable configuration and file mounts are removed.

`LWQL_TENANT_PREDICATE_TEMPLATE` and `LWQL_KEY_MAP_SELF_FILTER_TEMPLATE` in `platform/app/src/server/analytics/lwql/provisioning/accessModel.ts` become the single source of truth for the row-policy predicates and key-map self-filters. No other system defines these.

The sibling SaaS change (langwatch-saas#1255) deletes the SaaS rendered copy independently. The two changes are order-independent and can ship together.

## References

- Issue: https://github.com/langwatch/langwatch/issues/8258
- Related: ADR-101 (superseded by this decision)
- Related: `charts/langwatch/README.md` ("LangWatchQL (LWQL)")
- Related: `platform/app/src/tasks/provisionLwql.ts`
- Related: `specs/lwql/api.feature`
