# user

Users: profiles and avatars, account and single sign-on status, and the sign-in record.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                            |
| Subjects       | user, user-avatar                                                                          |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                   |
| Api token      | `UserApi` = `moduleApi<UserApi>()("user")`, `contract/src/user.api.ts:224` (64 operations) |
| Other token    | `UserAvatarFileApi`, `process/src/transport/user-avatar.rest.ts:23`                        |
| Installed by   | api, worker, tasks (process); ui (browser)                                                 |

## What user owns

| Kind                           | Name                                          | Declared at                                                                          |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Postgres table                 | `Account`                                     | `process/src/repositories/prisma/prisma.user-signin-credential.repository.ts:33`     |
| Postgres table                 | `User`                                        | `process/src/repositories/prisma/prisma.user.repository.ts:94`                       |
| Postgres table                 | `Account`                                     | `process/src/repositories/prisma/prisma.user.repository.ts:94`                       |
| Postgres table                 | `Passkey`                                     | `process/src/repositories/prisma/prisma.user.repository.ts:94`                       |
| Postgres, accessed not claimed | `Organization`, `OrganizationUser`, `Project` | `process/src/repositories/prisma/prisma.user-organization-directory.repository.ts:8` |
| Stores required                | prisma, redis                                 | `process/src/repositories/live/live.user.repositories.ts:11`                         |
| Config                         | `publicBaseUrl` (BASE_HOST)                   | `contract/src/user.config.ts:6`                                                      |

Anything else user needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name                | Token                  | Module                                                                      |
| ------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `auth`              | `AuthApi`              | [auth](../auth/README.md)                                                   |
| `authz`             | `AuthzApi`             | [authz](../authz/README.md)                                                 |
| `enterpriseGateway` | `EnterpriseGatewayApi` | [enterprise-gateway](../../enterprise/modules/enterprise-gateway/README.md) |
| `gateway`           | `GatewayApi`           | [gateway](../gateway/README.md)                                             |
| `governance`        | `GovernanceRestApi`    | [governance](../../enterprise/modules/governance/README.md)                 |
| `notifications`     | `NotificationService`  | [notification](../notification/README.md)                                   |
| `organizations`     | `OrganizationApi`      | [organization](../organization/README.md)                                   |
| `projects`          | `ProjectApi`           | [project](../project/README.md)                                             |
| `storedObjects`     | `StoredObjectApi`      | [stored-object](../stored-object/README.md)                                 |

## Who depends on user

[agent](../agent/README.md), [annotation](../annotation/README.md), [auth](../auth/README.md), [coding-agent](../coding-agent/README.md), [data-retention](../data-retention/README.md), [entitlement](../entitlement/README.md), [evaluator](../evaluator/README.md), [governance](../../enterprise/modules/governance/README.md), [identity](../identity/README.md), [langy](../langy/README.md), [nurturing](../../enterprise/modules/nurturing/README.md), [ops](../ops/README.md), [organization](../organization/README.md), [scenario](../scenario/README.md), [scim](../../enterprise/modules/scim/README.md) (as a peer).

<!-- readme:generated:end -->
