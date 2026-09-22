# ADR-141: The app owns the LangWatchQL access model — no rendered copy

**Date:** 2026-09-22

**Status:** Accepted

## Context

ADR-101 kept two owners of the LangWatchQL access model (`langwatch_lwql` user, `langwatch_profile` settings profile, row policies, grants, `lwql_postgres` named collection): a rendered-config copy for chart-managed/SaaS ClickHouse, and the application's SQL DDL for BYO ClickHouse. The rendered copy lived in `infra/clickhouse-serverless/internal/render/lwql.go` and was deployed by SaaS `render-config.sh` and the chart. The app's DDL lived in `platform/app/src/server/analytics/lwql/provisioning/` and ran on every boot.

Keeping two copies in sync was never stable. The rendered copies drifted from the app's catalog — the hand-vendored SaaS copy left roughly 113 of 129 production views returning 503, and the Go manifest needed parity tests just to stay in step with the app's definitions. Two owners of one model is a defect.

## Decision

The application owns the LangWatchQL access model, always, on every distribution (chart-managed, BYO, SaaS). No rendered copy exists. `lwql.enabled` (chart) and the presence of `LWQL_CLICKHOUSE_PASSWORD` (app) are the only switches that control whether LangWatchQL is active. Environment variables `LWQL_SELF_PROVISION` and `LWQL_MANAGE_POSTGRES_READER` are removed.

The ClickHouse server's only LangWatchQL-related config is the admin user's `access_management` and `named_collection_control` grants, plus the `custom_` settings prefix. If a server carries config-defined LangWatchQL entities (users, profiles, row policies, named collections) with the same names as the app will create, the app logs a warning, skips that entity, and continues. Boot never fails on ClickHouse errors 495 (ACCESS_STORAGE_READONLY), 669 (NAMED_COLLECTION_DOESNT_EXIST), 670 (NAMED_COLLECTION_ALREADY_EXISTS) or 671 (NAMED_COLLECTION_IS_IMMUTABLE).

## Rationale / Trade-offs

One owner means one catalog and no parity tests. The catalog is authoritative. BYO ClickHouse must grant the app administrative DDL rights to create these objects — `access_management`, `named_collection_control`, and the `custom_` settings prefix. This requirement is unchanged from ADR-101's BYO path. The PostgreSQL reader role `lwql_ro` is converged by the app on whatever PostgreSQL database the `DATABASE_URL` names, so that role needs CREATE/ALTER ROLE rights during provisioning. If those rights are not available, provisioning degrades to a logged, fail-closed refusal rather than a boot-time crash.

Migration from a rendered copy is not an outage. Operators remove the XML entity from ClickHouse config when convenient, and the app converges the SQL-owned entity to match — on the next boot, and, within a single upgrade, because the running app watches the config store and re-provisions once the old pod's rendered model is gone (see Residual risk).

## Consequences

The following files are deleted: `infra/clickhouse-serverless/internal/render/lwql.go`, `lwql_catalog.json`, `lwqlTenantPredicate.sql`, `lwqlKeyMapSelfFilter.sql` and their tests (`lwql_sourcecolumns_test.go`, `lwql_tenantcolumn_test.go`). The TypeScript manifest and predicate parity tests are also removed.

The chart's `clickhouse.lwqlAccessModel` values block and the `clickhouse-serverless` subchart's LWQL environment variable configuration and file mounts are removed.

`LWQL_TENANT_PREDICATE_TEMPLATE` and `LWQL_KEY_MAP_SELF_FILTER_TEMPLATE` in `platform/app/src/server/analytics/lwql/provisioning/accessModel.ts` become the single source of truth for the row-policy predicates and key-map self-filters. No other system defines these.

The sibling SaaS change (langwatch-saas#1255) deletes the SaaS rendered copy independently. The two changes are order-independent and can ship together.

### Residual risk

A config-store-owned LangWatchQL entity (user, settings profile, row policy, named collection) is trusted as-is — the app skips it by name and does not verify its substance (readonly setting, profile constraints, row-policy predicate, collection target). A wrongly defined config-owned entity can therefore widen or break tenant isolation, and the operator owns removing or correcting it. The app's boot-time WARN log names each such entity. A 495 (ACCESS_STORAGE_READONLY) error on an entity NOT found in the config-store inventory is treated as a failure, not a skip.

A helm upgrade opens a short window where the access model exists nowhere. The new app image can boot against the OLD ClickHouse pod, which still serves `users.d/lwql.yaml`, so the access-model DDL is skipped as config-store-owned (495). Moments later the StatefulSet rolls to the new chart, which renders no access model — the XML identity disappears and, without intervention, nothing re-provisions until the next app boot. The running app watches the config store and re-provisions once the old pod's rendered model is gone: the deploy task is a short-lived process (it returns and exits, so unref'd timers in it would never fire), so the watch lives in the long-running app server (`src/start.ts`, armed once it is listening). It polls the config store on an exponential backoff (30s, doubling, capped at 5 minutes); the moment a probe finds the config store owns zero LangWatchQL entities it re-provisions the app-owned model once and stops. A probe that throws (the ClickHouse pod is mid-roll) is treated as still-waiting; a first probe of zero means there was no upgrade window and the watch stops silently; a config store that never releases the model gives up at a ~30-minute budget with a warning. The poll timers are unref'd, so they never hold shutdown open, and a hard provisioning failure (as opposed to a config-store skip) is left fail-closed for the next boot rather than retried.

## References

- Issue: https://github.com/langwatch/langwatch/issues/8258
- Related: ADR-101 (superseded by this decision)
- Related: `charts/langwatch/README.md` ("LangWatchQL (LWQL)")
- Related: `platform/app/src/tasks/provisionLwql.ts`
- Related: `specs/lwql/api.feature`
