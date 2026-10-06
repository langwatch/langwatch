# coding-agent

Coding-agent observability: sessions built from coding-agent traces, their transcripts, and the pull requests those sessions are linked to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | coding-agent                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                 |
| Api token      | `CodingAgentApi` = `moduleApi<CodingAgentApi>()("coding-agent")`, `contract/src/coding-agent.api.ts:144` (21 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                               |

## What coding-agent owns

| Kind                      | Name                          | Declared at                                                                                   |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| ClickHouse table (writes) | `coding_agent_session_events` | `process/src/repositories/clickhouse/clickhouse.coding-agent-session-event.repository.ts:213` |
| ClickHouse table (writes) | `coding_agent_sessions`       | `process/src/repositories/clickhouse/clickhouse.coding-agent-session.repository.ts:437`       |
| ClickHouse table (writes) | `coding_agent_trace_sessions` | `process/src/repositories/clickhouse/clickhouse.coding-agent-trace-session.repository.ts:73`  |
| ClickHouse table (writes) | `session_metric_series`       | `process/src/repositories/clickhouse/clickhouse.session-metric-series.repository.ts:93`       |
| Stores required           | clickhouse                    | `process/src/repositories/clickhouse/clickhouse.coding-agent.repositories.ts:23`              |
| Stores required           | clickhouse, redis             | `process/src/repositories/live/live.coding-agent.repositories.ts:11`                          |

Anything else coding-agent needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token               | Module                                                      |
| --------------- | ------------------- | ----------------------------------------------------------- |
| `auditLog`      | `AuditLogApi`       | [audit-log](../audit-log/README.md)                         |
| `authz`         | `AuthzApi`          | [authz](../authz/README.md)                                 |
| `github`        | `GithubApi`         | [github](../github/README.md)                               |
| `governance`    | `GovernanceRestApi` | [governance](../../enterprise/modules/governance/README.md) |
| `organizations` | `OrganizationApi`   | [organization](../organization/README.md)                   |
| `projects`      | `ProjectApi`        | [project](../project/README.md)                             |
| `retention`     | `DataRetentionApi`  | [data-retention](../data-retention/README.md)               |
| `traces`        | `TraceApi`          | [trace](../trace/README.md)                                 |
| `users`         | `UserApi`           | [user](../user/README.md)                                   |

## Who depends on coding-agent

[github](../github/README.md), [ops](../ops/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
