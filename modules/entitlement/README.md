# entitlement

What a plan allows, and what has been used and spent against it, so the allowance a banner quotes and the usage a panel shows are the same answer.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                      |
| Subjects       | entitlement, usage                                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                                                  |
| Api token      | `EntitlementApi` = `moduleApi<EntitlementApi>()("entitlement")`, `contract/src/entitlement.api.ts:40` (7 operations) |
| Installed by   | api, worker, tasks (process)                                                                                         |

## What entitlement owns

| Kind                      | Name                                                           | Declared at                                                                             |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `billable_events`                                              | `process/src/repositories/clickhouse/clickhouse.billable-events-meter.repository.ts:36` |
| ClickHouse table (writes) | `usage_trace_meter`                                            | `process/src/repositories/clickhouse/clickhouse.trace-meter.repository.ts:31`           |
| Stores required           | prisma, clickhouse                                             | `process/src/repositories/live/live.entitlement.repositories.ts:10`                     |
| Stores required           | prisma                                                         | `process/src/repositories/prisma/prisma.entitlement.repositories.ts:13`                 |
| Config                    | `requestBounds` (LANGWATCH_REQUEST_BOUNDS), `isSaas` (IS_SAAS) | `contract/src/entitlement.config.ts:20`                                                 |

Anything else entitlement needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                    |
| --------------- | ----------------- | --------------------------------------------------------- |
| `billing`       | `BillingApi`      | [billing](../../enterprise/modules/billing/README.md)     |
| `license`       | `LicensingApi`    | [licensing](../../enterprise/modules/licensing/README.md) |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md)                 |
| `projects`      | `ProjectApi`      | [project](../project/README.md)                           |

## Who depends on entitlement

[analytics](../analytics/README.md), [annotation](../annotation/README.md), [auth](../auth/README.md), [automation](../automation/README.md), [data-retention](../data-retention/README.md), [dataset](../dataset/README.md), [experiment](../experiment/README.md), [governance](../../enterprise/modules/governance/README.md), [identity](../identity/README.md), [instant-eval](../instant-eval/README.md), [langy](../langy/README.md), [organization](../organization/README.md), [prompt](../prompt/README.md), [role](../role/README.md), [scenario](../scenario/README.md), [scim](../../enterprise/modules/scim/README.md), [trace](../trace/README.md), [webhook](../webhook/README.md) (as a peer).

<!-- readme:generated:end -->
