# usage

Usage: the billable-events meter, the month's count and the limit decisions peers react to. It answers by events, so its token carries no operation yet.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                 |
| Subjects       | usage                                                                                           |
| Halves         | [contract](contract) · [process](process)                                                       |
| Api token      | `UsageApi` = `moduleApi<UsageApi>()("usage")`, `contract/src/usage.events.ts:59` (0 operations) |
| Installed by   | api, worker, tasks (process)                                                                    |

## What usage owns

| Kind                      | Name                | Declared at                                                                             |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `billable_events`   | `process/src/repositories/clickhouse/clickhouse.billable-events-meter.repository.ts:34` |
| ClickHouse table (writes) | `usage_trace_meter` | `process/src/repositories/clickhouse/clickhouse.trace-meter.repository.ts:36`           |
| Stores required           | clickhouse          | `process/src/repositories/clickhouse/clickhouse.usage.repositories.ts:9`                |
| Config                    | `isSaas` (IS_SAAS)  | `contract/src/usage.events.ts:63`                                                       |

Anything else usage needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token            | Module                                                |
| ------------- | ---------------- | ----------------------------------------------------- |
| `billing`     | `BillingApi`     | [billing](../../enterprise/modules/billing/README.md) |
| `entitlement` | `EntitlementApi` | [entitlement](../entitlement/README.md)               |
| `projects`    | `ProjectApi`     | [project](../project/README.md)                       |

## Who depends on usage

No module names usage as a peer.

<!-- readme:generated:end -->
