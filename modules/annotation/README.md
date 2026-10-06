# annotation

Annotations on traces: comments, scores and reviews, and the annotation queues reviewers work through.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Classification | core (`modules/catalogue.json`)                                                                                    |
| Subjects       | annotation                                                                                                         |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                                           |
| Api token      | `AnnotationApi` = `moduleApi<AnnotationApi>()("annotation")`, `contract/src/annotation.api.ts:118` (32 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                         |

## What annotation owns

| Kind           | Name                     | Declared at                                                                      |
| -------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Postgres table | `Annotation`             | `process/src/repositories/prisma/prisma.annotation-count.repository.ts:8`        |
| Postgres table | `AnnotationQueue`        | `process/src/repositories/prisma/prisma.annotation-count.repository.ts:8`        |
| Postgres table | `AnnotationQueueItem`    | `process/src/repositories/prisma/prisma.annotation-count.repository.ts:8`        |
| Postgres table | `AnnotationScore`        | `process/src/repositories/prisma/prisma.annotation-count.repository.ts:8`        |
| Postgres table | `AnnotationQueue`        | `process/src/repositories/prisma/prisma.annotation-queue-item.repository.ts:141` |
| Postgres table | `AnnotationQueueItem`    | `process/src/repositories/prisma/prisma.annotation-queue-item.repository.ts:141` |
| Postgres table | `AnnotationQueue`        | `process/src/repositories/prisma/prisma.annotation-queue.repository.ts:33`       |
| Postgres table | `AnnotationQueueMembers` | `process/src/repositories/prisma/prisma.annotation-queue.repository.ts:33`       |
| Postgres table | `AnnotationQueueScores`  | `process/src/repositories/prisma/prisma.annotation-queue.repository.ts:33`       |
| Postgres table | `AnnotationScore`        | `process/src/repositories/prisma/prisma.annotation-score.repository.ts:33`       |
| Postgres table | `Annotation`             | `process/src/repositories/prisma/prisma.annotation.repository.ts:74`             |

Anything else annotation needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                    |
| --------------- | ----------------- | ----------------------------------------- |
| `entitlement`   | `EntitlementApi`  | [entitlement](../entitlement/README.md)   |
| `organizations` | `OrganizationApi` | [organization](../organization/README.md) |
| `permissions`   | `AuthzApi`        | [authz](../authz/README.md)               |
| `projects`      | `ProjectApi`      | [project](../project/README.md)           |
| `traces`        | `TraceApi`        | [trace](../trace/README.md)               |
| `users`         | `UserApi`         | [user](../user/README.md)                 |

## Who depends on annotation

[audit-log](../audit-log/README.md), [automation](../automation/README.md), [ops](../ops/README.md), [trace](../trace/README.md) (as a peer).

<!-- readme:generated:end -->
