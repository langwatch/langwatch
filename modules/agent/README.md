# agent

Agents a project builds and runs: their workflow configurations, the connected agent instances that register and poll, and calls made to them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                |
| Subjects       | agent                                                                                          |
| Halves         | [contract](contract) · [process](process) · [browser](browser)                                 |
| Api token      | `AgentApi` = `moduleApi<AgentApi>()("agent")`, `contract/src/agent.api.ts:189` (45 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                     |

## What agent owns

| Kind            | Name                                                                                                                             | Declared at                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Postgres table  | `Agent`                                                                                                                          | `process/src/repositories/prisma/prisma.agent.repository.ts:69` |
| Stores required | redis                                                                                                                            | `process/src/repositories/redis/redis.agent.repositories.ts:8`  |
| Config          | `replicaCount` (LANGWATCH_APP_REPLICAS), `relayMaxPayloadMb` (LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB), `publicBaseUrl` (BASE_HOST) | `contract/src/agent.api.ts:197`                                 |

Anything else agent needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `auditLog`     | `AuditLogApi`    | [audit-log](../audit-log/README.md)       |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `permissions`  | `AuthzApi`       | [authz](../authz/README.md)               |
| `projects`     | `ProjectApi`     | [project](../project/README.md)           |
| `scenarios`    | `ScenarioApi`    | [scenario](../scenario/README.md)         |
| `secrets`      | `SecretApi`      | [secret](../secret/README.md)             |
| `traces`       | `TraceApi`       | [trace](../trace/README.md)               |
| `users`        | `UserApi`        | [user](../user/README.md)                 |
| `workflows`    | `WorkflowApi`    | [workflow](../workflow/README.md)         |

## Who depends on agent

[audit-log](../audit-log/README.md), [experiment](../experiment/README.md), [governance](../../enterprise/modules/governance/README.md), [langy](../langy/README.md), [scenario](../scenario/README.md), [suite](../suite/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
