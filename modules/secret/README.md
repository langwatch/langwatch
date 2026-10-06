# secret

Project secrets: storing, listing, updating and reading their values by id or name.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                   |
| Subjects       | secret                                                                                            |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                          |
| Api token      | `SecretApi` = `moduleApi<SecretApi>()("secret")`, `contract/src/secret.api.ts:42` (10 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                        |

## What secret owns

| Kind            | Name                      | Declared at                                                      |
| --------------- | ------------------------- | ---------------------------------------------------------------- |
| Postgres table  | `ProjectSecret`           | `process/src/repositories/prisma/prisma.secret.repository.ts:40` |
| Stores required | prisma, encryption, redis | `process/src/repositories/live/live.secret.repositories.ts:13`   |

Anything else secret needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name          | Token      | Module                      |
| ------------- | ---------- | --------------------------- |
| `permissions` | `AuthzApi` | [authz](../authz/README.md) |

## Who depends on secret

[agent](../agent/README.md), [gateway](../gateway/README.md), [langy](../langy/README.md), [scenario](../scenario/README.md), [workflow](../workflow/README.md) (as a peer).

<!-- readme:generated:end -->
