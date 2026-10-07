# share

Share links: creating, resolving and revoking them, and the retention pin an active link holds on its trace.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                               |
| Subjects       | share                                                                                         |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                      |
| Api token      | `ShareApi` = `moduleApi<ShareApi>()("share")`, `contract/src/share.api.ts:36` (12 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                    |

## What share owns

| Kind            | Name          | Declared at                                                           |
| --------------- | ------------- | --------------------------------------------------------------------- |
| Postgres table  | `ShareLink`   | `process/src/repositories/prisma/prisma.share-grant.repository.ts:81` |
| Postgres table  | `Grant`       | `process/src/repositories/prisma/prisma.share-grant.repository.ts:81` |
| Postgres table  | `GrantUsage`  | `process/src/repositories/prisma/prisma.share-grant.repository.ts:81` |
| Postgres table  | `ShareLink`   | `process/src/repositories/prisma/prisma.share.repository.ts:40`       |
| Stores required | prisma, redis | `process/src/repositories/live/live.share.repositories.ts:14`         |

Anything else share needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token              | Module                                        |
| --------------- | ------------------ | --------------------------------------------- |
| `authorization` | `AuthzApi`         | [authz](../authz/README.md)                   |
| `dataRetention` | `DataRetentionApi` | [data-retention](../data-retention/README.md) |
| `projects`      | `ProjectApi`       | [project](../project/README.md)               |

## Who depends on share

[organization](../organization/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
