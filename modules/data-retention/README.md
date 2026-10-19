# data-retention

Data retention: the retention policy per scope, the pins that keep data past it, and its metering.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                                  |
| Subjects       | data-retention                                                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                         |
| Api token      | `DataRetentionApi` = `moduleApi<DataRetentionApi>()("data-retention")`, `contract/src/data-retention.api.ts:100` (23 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                                       |

## What data-retention owns

| Kind                           | Name                                                                                                       | Declared at                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Postgres table                 | `RetentionPolicy`                                                                                          | `process/src/repositories/prisma/prisma.data-retention.repository.ts:21`           |
| Postgres table                 | `PinnedTrace`                                                                                              | `process/src/repositories/prisma/prisma.pinned-trace.repository.ts:13`             |
| Postgres, accessed not claimed | `Organization`, `Project`, `Team`                                                                          | `process/src/repositories/prisma/prisma.data-retention-directory.repository.ts:16` |
| Stores required                | prisma, clickhouse, redis                                                                                  | `process/src/repositories/live/live.data-retention.repositories.ts:24`             |
| Config                         | `platformDefaultDays` (LANGWATCH_DEFAULT_RETENTION_DAYS), `isSaas` (IS_SAAS), `nodeEnvironment` (NODE_ENV) | `contract/src/data-retention.config.ts:15`                                         |

Anything else data-retention needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token            | Module                                  |
| ------------- | ---------------- | --------------------------------------- |
| `entitlement` | `EntitlementApi` | [entitlement](../entitlement/README.md) |
| `permissions` | `AuthzApi`       | [authz](../authz/README.md)             |
| `users`       | `UserApi`        | [user](../user/README.md)               |

## Who depends on data-retention

[analytics](../analytics/README.md), [automation](../automation/README.md), [coding-agent](../coding-agent/README.md), [evaluation](../evaluation/README.md), [experiment](../experiment/README.md), [governance](../../enterprise/modules/governance/README.md), [langy](../langy/README.md), [log](../log/README.md), [metric](../metric/README.md), [ops](../ops/README.md), [scenario](../scenario/README.md), [share](../share/README.md), [suite](../suite/README.md), [topic](../topic/README.md), [trace](../trace/README.md), [webhook](../webhook/README.md) (as a peer).

<!-- readme:generated:end -->
