# role

Roles: the built-in roles and the custom roles an organisation defines.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                           |
| Subjects       | custom-role, role                                                                         |
| Halves         | [contract](contract) · [process](process)                                                 |
| Api token      | `RoleApi` = `moduleApi<RoleApi>()("role")`, `contract/src/role.api.ts:68` (13 operations) |
| Installed by   | api, worker, tasks (process)                                                              |

## What role owns

| Kind           | Name         | Declared at                                                    |
| -------------- | ------------ | -------------------------------------------------------------- |
| Postgres table | `CustomRole` | `process/src/repositories/prisma/prisma.role.repository.ts:34` |
| Postgres table | `TeamUser`   | `process/src/repositories/prisma/prisma.role.repository.ts:34` |

Anything else role needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `entitlement`   | `EntitlementApi`  | [entitlement](../entitlement/README.md)   |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `permissions`   | `AuthzApi`        | [authz](../authz/README.md)               |

## Who depends on role

[organization](../organization/README.md) (as a peer).

<!-- readme:generated:end -->
