# analytics

Analytics reads: timeseries, feedback and most-used documents over trace and evaluation data, the filter options that drive them, LangWatchQL, and the evaluation analytics rows behind those reads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                |
| Subjects       | analytics                                                                                                      |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                    |
| Api token      | `AnalyticsApi` = `moduleApi<AnalyticsApi>()("analytics")`, `contract/src/analytics.api.ts:211` (30 operations) |
| Other token    | `AnalyticsLegacyApi`, `process/src/transport/analytics-legacy.rest.ts:29`                                      |
| Other token    | `AnalyticsLwqlApi`, `process/src/transport/analytics-lwql.trpc.ts:56`                                          |
| Other token    | `AnalyticsQueryApi`, `process/src/transport/query.rest.ts:53`                                                  |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                     |

## What analytics owns

| Kind                      | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Declared at                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `evaluation_analytics`                                                                                                                                                                                                                                                                                                                                                                                                                                           | `process/src/repositories/clickhouse/clickhouse.analytics-persistence.repository.ts:91`  |
| ClickHouse table (writes) | `evaluation_analytics_rollup`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `process/src/repositories/clickhouse/clickhouse.analytics-persistence.repository.ts:209` |
| ClickHouse table (writes) | `lwql_api_key_tenant_map`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `process/src/repositories/clickhouse/clickhouse.langwatch-ql-key-map.repository.ts:40`   |
| Stores required           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `process/src/channels/analytics.channels.ts:15`                                          |
| Stores required           | clickhouse, rateLimiter, clickhouseAdmin, databaseTarget, prisma                                                                                                                                                                                                                                                                                                                                                                                                 | `process/src/repositories/live/live.analytics.repositories.ts:15`                        |
| Secrets                   | `lwqlClickHousePassword` (LWQL_CLICKHOUSE_PASSWORD), `lwqlPostgresReaderPassword` (LWQL_POSTGRES_READER_PASSWORD)                                                                                                                                                                                                                                                                                                                                                | `process/src/app/analytics.app.ts:352`                                                   |
| Config                    | `langwatchQl.url` (LWQL_CLICKHOUSE_URL), `langwatchQl.username` (LWQL_CLICKHOUSE_USER), `langwatchQl.database` (LWQL_DATABASE), `langwatchQl.tenantSetting` (LWQL_TENANT_SETTING), `langwatchQl.postgresHost` (LWQL_POSTGRES_HOST), `langwatchQl.accessModelMode` (LWQL_ACCESS_MODEL_MODE), `langwatchQl.sqlSingleNode` (LWQL_ACCESS_MODEL_SQL_SINGLE_NODE), `tenantAnalyticsConcurrency` (CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY), `publicBaseUrl` (BASE_HOST) | `contract/src/analytics.config.ts:11`                                                    |

Anything else analytics needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token              | Module                                        |
| -------------- | ------------------ | --------------------------------------------- |
| `authz`        | `AuthzApi`         | [authz](../authz/README.md)                   |
| `dataPrivacy`  | `DataPrivacyApi`   | [data-privacy](../data-privacy/README.md)     |
| `featureFlags` | `FeatureFlagApi`   | [feature-flag](../feature-flag/README.md)     |
| `plans`        | `EntitlementApi`   | [entitlement](../entitlement/README.md)       |
| `projects`     | `ProjectApi`       | [project](../project/README.md)               |
| `retention`    | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `traces`       | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on analytics

[automation](../automation/README.md), [dashboard](../dashboard/README.md), [evaluation](../evaluation/README.md), [insight](../insight/README.md), [instant-eval](../instant-eval/README.md), [ops](../ops/README.md) (as a peer).

<!-- readme:generated:end -->
