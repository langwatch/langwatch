# topic

A project's conversation topics, and what the last topic-clustering run did.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                           |
| Subjects       | topic, topic-clustering                                                                   |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                  |
| Api token      | `TopicApi` = `moduleApi<TopicApi>()("topic")`, `contract/src/topic.ts:111` (5 operations) |
| Other token    | `TopicBrowserApi`, `process/src/transport/topic.trpc.ts:30`                               |
| Installed by   | api, worker, tasks (process); ui (browser)                                                |

## What topic owns

| Kind                           | Name                                                                | Declared at                                                                |
| ------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Postgres table                 | `Topic`                                                             | `process/src/repositories/prisma/prisma.topic.repository.ts:27`            |
| Postgres table                 | `TopicClusteringRunProjection`                                      | `process/src/repositories/prisma/prisma.topic.repository.ts:27`            |
| Postgres table                 | `TopicClusteringRunHistoryProjection`                               | `process/src/repositories/prisma/prisma.topic.repository.ts:27`            |
| Postgres, accessed not claimed | `Cost`, `ProcessManagerInstance`, `Project`, `TopicModelProjection` | `process/src/repositories/prisma/prisma.topic-clustering.repository.ts:17` |
| Stores required                | prisma, redis                                                       | `process/src/repositories/live/live.topic.repositories.ts:12`              |
| Stores required                | prisma                                                              | `process/src/repositories/prisma/prisma.topic.repositories.ts:29`          |

Anything else topic needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name             | Token              | Module                                        |
| ---------------- | ------------------ | --------------------------------------------- |
| `evaluations`    | `EvaluationApi`    | [evaluation](../evaluation/README.md)         |
| `modelProviders` | `ModelProviderApi` | [model-provider](../model-provider/README.md) |
| `traces`         | `TraceApi`         | [trace](../trace/README.md)                   |

## Who depends on topic

No module names topic as a peer.

<!-- readme:generated:end -->
