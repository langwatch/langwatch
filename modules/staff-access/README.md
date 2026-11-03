# staff-access

Staff access lets a platform operator's coding agent reach production for one hour at a time. The agent asks with a requester key, the operator approves each request with a passkey on a page that shows exactly what the signature approves, and the agent redeems once for a key pinned to its address. Every request that key makes is recorded before it runs. See [ADR-192](../../dev/docs/adr/192-ops-agent-access.md).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                          |
| Subjects       | staff-access                                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                                 |
| Api token      | `StaffAccessApi` = `moduleApi<StaffAccessApi>()("staff-access")`, `contract/src/staff-access.api.ts:107` (18 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                               |

## What staff-access owns

| Kind            | Name                        | Declared at                                                              |
| --------------- | --------------------------- | ------------------------------------------------------------------------ |
| Postgres table  | `StaffAccessRequester`      | `process/src/repositories/prisma/prisma.staff-access.repository.ts:34`   |
| Postgres table  | `StaffAccessChallenge`      | `process/src/repositories/prisma/prisma.staff-access.repository.ts:103`  |
| Postgres table  | `StaffAccessRequest`        | `process/src/repositories/prisma/prisma.staff-access.repository.ts:155`  |
| Postgres table  | `StaffAccessEvent`          | `process/src/repositories/prisma/prisma.staff-access.repository.ts:353`  |
| Stores required | prisma                      | `process/src/repositories/prisma/prisma.staff-access.repositories.ts:16` |
| Config          | `publicBaseUrl` (BASE_HOST) | `contract/src/staff-access.config.ts:5`                                  |

Anything else staff-access needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token                 | Module                                    |
| --------------- | --------------------- | ----------------------------------------- |
| `apiKeys`       | `ApiKeyApi`           | [api-key](../api-key/README.md)           |
| `auditLog`      | `AuditLogApi`         | [audit-log](../audit-log/README.md)       |
| `auth`          | `AuthApi`             | [auth](../auth/README.md)                 |
| `codingAgents`  | `CodingAgentApi`      | [coding-agent](../coding-agent/README.md) |
| `featureFlags`  | `FeatureFlagApi`      | [feature-flag](../feature-flag/README.md) |
| `gateway`       | `GatewayApi`          | [gateway](../gateway/README.md)           |
| `notifications` | `NotificationService` | [notification](../notification/README.md) |
| `ops`           | `OpsApi`              | [ops](../ops/README.md)                   |
| `organizations` | `OrganizationApi`     | [organization](../organization/README.md) |
| `projects`      | `ProjectApi`          | [project](../project/README.md)           |
| `traces`        | `TraceApi`            | [trace](../trace/README.md)               |
| `users`         | `UserApi`             | [user](../user/README.md)                 |

## Who depends on staff-access

No module names staff-access as a peer.

<!-- readme:generated:end -->
