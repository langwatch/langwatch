# nurturing

Product analytics and lifecycle messaging: every owner tells nurturing through a subscriber on its own pipeline, and nurturing alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                          |
| Subjects       | nurturing, product-milestone                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                                            |
| Api token      | `NurturingApi` = `moduleApi<NurturingApi>()("nurturing")`, `contract/src/nurturing-types.ts:188` (1 operation) |
| Installed by   | api, worker, tasks (process)                                                                                   |

## What nurturing owns

| Kind                           | Name                                                                                                                                          | Declared at                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Postgres table                 | `NurturingOrganization`                                                                                                                       | `process/src/repositories/prisma/prisma.nurturing-milestones.repository.ts:19`        |
| Postgres, accessed not claimed | `Project`, `Team`                                                                                                                             | `process/src/repositories/prisma/prisma.nurturing-project-directory.repository.ts:10` |
| Stores required                |                                                                                                                                               | `process/src/channels/http/http.customer-io.channel.ts:19`                            |
| Stores required                |                                                                                                                                               | `process/src/channels/http/http.nurturing.channels.ts:13`                             |
| Stores required                | prisma, redis                                                                                                                                 | `process/src/repositories/live/live.nurturing.repositories.ts:11`                     |
| Stores required                | ≈ `ownedRepositories.requires`                                                                                                                | `process/src/repositories/prisma/prisma.nurturing.repositories.ts:16`                 |
| Secrets                        | CUSTOMER_IO_API_KEY                                                                                                                           | `process/src/app/nurturing.app.ts:32`                                                 |
| Config                         | `customerIoRegion` (CUSTOMER_IO_REGION), `customerIoBaseUrl` (CUSTOMER_IO_BASE_URL), `posthogKey` (POSTHOG_KEY), `posthogHost` (POSTHOG_HOST) | `contract/src/nurturing.config.ts:7`                                                  |

Anything else nurturing needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name    | Token     | Module                                  |
| ------- | --------- | --------------------------------------- |
| `users` | `UserApi` | [user](../../../modules/user/README.md) |

## Who depends on nurturing

No module names nurturing as a peer.

<!-- readme:generated:end -->
