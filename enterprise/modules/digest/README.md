# digest

Weekly digest emails, on for every organization: folds each organization's week, picks a template per person and organization and sends it. One email per person per organization; one opt-out per person.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Classification | enterprise (`modules/catalogue.json`)                                                            |
| Subjects       | digest                                                                                           |
| Halves         | [contract](contract) · [process](process/README.md)                                              |
| Api token      | `DigestApi` = `moduleApi<DigestApi>()("digest")`, `contract/src/digest.api.ts:61` (9 operations) |
| Installed by   | api, worker, tasks (process)                                                                     |

## What digest owns

| Kind            | Name                            | Declared at                                                                   |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| Postgres table  | `DigestSubscription`            | `process/src/repositories/prisma/prisma.digest-audience.repository.ts:12`     |
| Postgres table  | `DigestSettings`                | `process/src/repositories/prisma/prisma.digest-audience.repository.ts:12`     |
| Postgres table  | `DigestProjectWeek`             | `process/src/repositories/prisma/prisma.digest-project-week.repository.ts:24` |
| Postgres table  | `DigestSend`                    | `process/src/repositories/prisma/prisma.digest-send.repository.ts:16`         |
| Postgres table  | `DigestUserWeek`                | `process/src/repositories/prisma/prisma.digest-user-week.repository.ts:24`    |
| Stores required |                                 | `process/src/channels/http/http.digest.channels.ts:10`                        |
| Stores required | prisma, redis                   | `process/src/repositories/live/live.digest.repositories.ts:11`                |
| Secrets         | `unsubscribe` (NEXTAUTH_SECRET) | `process/src/app/digest.app.ts:73`                                            |
| Config          | `publicBaseUrl` (BASE_HOST)     | `contract/src/digest.config.ts:5`                                             |

Anything else digest needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                  |
| --------------- | ----------------- | ------------------------------------------------------- |
| `analytics`     | `AnalyticsApi`    | [analytics](../../../modules/analytics/README.md)       |
| `authz`         | `AuthzApi`        | [authz](../../../modules/authz/README.md)               |
| `entitlement`   | `EntitlementApi`  | [entitlement](../../../modules/entitlement/README.md)   |
| `ops`           | `OpsApi`          | [ops](../../../modules/ops/README.md)                   |
| `organizations` | `OrganizationApi` | [organization](../../../modules/organization/README.md) |
| `projects`      | `ProjectApi`      | [project](../../../modules/project/README.md)           |
| `users`         | `UserApi`         | [user](../../../modules/user/README.md)                 |

## Who depends on digest

No module names digest as a peer.

<!-- readme:generated:end -->
