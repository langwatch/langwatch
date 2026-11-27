# nurturing

Product analytics and lifecycle messaging: nurturing learns from the owners' events, keeps its own copies, and alone talks to PostHog and Customer.io.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                          |
| Subjects       | nurturing, product-milestone                                                                                   |
| Halves         | [contract](contract) · [process](process/README.md)                                                            |
| Api token      | `NurturingApi` = `moduleApi<NurturingApi>()("nurturing")`, `contract/src/nurturing-types.ts:299` (1 operation) |
| Installed by   | api, worker, tasks (process)                                                                                   |

## What nurturing owns

| Kind                           | Name                                                                                                                                          | Declared at                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Postgres table                 | `NurturingErasedUser`                                                                                                                         | `process/src/repositories/prisma/prisma.nurturing-erased-user.repository.ts:15`          |
| Postgres table                 | `NurturingProjectEvaluationDay`                                                                                                               | `process/src/repositories/prisma/prisma.nurturing-evaluation-day.repository.ts:14`       |
| Postgres table                 | `NurturingVirtualKey`                                                                                                                         | `process/src/repositories/prisma/prisma.nurturing-gateway-key.repository.ts:30`          |
| Postgres table                 | `NurturingOrganization`                                                                                                                       | `process/src/repositories/prisma/prisma.nurturing-milestones.repository.ts:46`           |
| Postgres table                 | `NurturingOrganizationCreated`                                                                                                                | `process/src/repositories/prisma/prisma.nurturing-organization-created.repository.ts:14` |
| Postgres table                 | `NurturingOrganizationMember`                                                                                                                 | `process/src/repositories/prisma/prisma.nurturing-organization-member.repository.ts:37`  |
| Postgres table                 | `NurturingOrganizationPlan`                                                                                                                   | `process/src/repositories/prisma/prisma.nurturing-organization-plan.repository.ts:13`    |
| Postgres table                 | `NurturingPersonalProject`                                                                                                                    | `process/src/repositories/prisma/prisma.nurturing-personal-project.repository.ts:30`     |
| Postgres table                 | `NurturingProject`                                                                                                                            | `process/src/repositories/prisma/prisma.nurturing-project-placement.repository.ts:12`    |
| Postgres table                 | `NurturingProjectUsageView`                                                                                                                   | `process/src/repositories/prisma/prisma.nurturing-project-usage.repository.ts:30`        |
| Postgres table                 | `NurturingProjectTraceDayCount`                                                                                                               | `process/src/repositories/prisma/prisma.nurturing-trace-day.repository.ts:64`            |
| Postgres table                 | `NurturingTracedProject`                                                                                                                      | `process/src/repositories/prisma/prisma.nurturing-traced-project.repository.ts:13`       |
| Postgres, accessed not claimed | `Organization`, `Project`, `Team`                                                                                                             | `process/src/repositories/prisma/prisma.nurturing-project-directory.repository.ts:12`    |
| Stores required                |                                                                                                                                               | `process/src/channels/http/http.customer-io.channel.ts:20`                               |
| Stores required                |                                                                                                                                               | `process/src/channels/http/http.nurturing.channels.ts:13`                                |
| Stores required                | prisma, redis                                                                                                                                 | `process/src/repositories/live/live.nurturing.repositories.ts:11`                        |
| Stores required                | ≈ `ownedRepositories.requires`                                                                                                                | `process/src/repositories/prisma/prisma.nurturing.repositories.ts:43`                    |
| Secrets                        | CUSTOMER_IO_API_KEY                                                                                                                           | `process/src/app/nurturing.app.ts:51`                                                    |
| Config                         | `customerIoRegion` (CUSTOMER_IO_REGION), `customerIoBaseUrl` (CUSTOMER_IO_BASE_URL), `posthogKey` (POSTHOG_KEY), `posthogHost` (POSTHOG_HOST) | `contract/src/nurturing.config.ts:8`                                                     |

Anything else nurturing needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                  |
| --------------- | ----------------- | ------------------------------------------------------- |
| `organizations` | `OrganizationApi` | [organization](../../../modules/organization/README.md) |
| `users`         | `UserApi`         | [user](../../../modules/user/README.md)                 |

## Who depends on nurturing

No module names nurturing as a peer.

<!-- readme:generated:end -->
