# agent

Agents a project builds and runs: their workflow configurations, the connected agent instances that register and poll, and calls made to them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                |
| Subjects       | agent                                                                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)    |
| Api token      | `AgentApi` = `moduleApi<AgentApi>()("agent")`, `contract/src/agent.api.ts:174` (42 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                     |

## What agent owns

| Kind            | Name                                                                                                                             | Declared at                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Postgres table  | `Agent`                                                                                                                          | `process/src/repositories/prisma/prisma.agent.repository.ts:108` |
| Postgres table  | `AgentVersion`                                                                                                                   | `process/src/repositories/prisma/prisma.agent.repository.ts:108` |
| Postgres table  | `AgentVersionLabel`                                                                                                              | `process/src/repositories/prisma/prisma.agent.repository.ts:108` |
| Stores required | redis                                                                                                                            | `process/src/channels/redis/redis.agent.channels.ts:8`           |
| Stores required | redis                                                                                                                            | `process/src/repositories/redis/redis.agent.repositories.ts:9`   |
| Config          | `replicaCount` (LANGWATCH_APP_REPLICAS), `relayMaxPayloadMb` (LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB), `publicBaseUrl` (BASE_HOST) | `contract/src/agent.config.ts:10`                                |

Anything else agent needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `auditLog`     | `AuditLogApi`    | [audit-log](../audit-log/README.md)       |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `permissions`  | `AuthzApi`       | [authz](../authz/README.md)               |
| `projects`     | `ProjectApi`     | [project](../project/README.md)           |
| `secrets`      | `SecretApi`      | [secret](../secret/README.md)             |
| `users`        | `UserApi`        | [user](../user/README.md)                 |

## Who depends on agent

[experiment](../experiment/README.md), [governance](../../enterprise/modules/governance/README.md), [langy](../langy/README.md), [scenario](../scenario/README.md), [suite](../suite/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
