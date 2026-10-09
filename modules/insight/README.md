# Insight

Owns insights: short findings about a project that Langy writes into an inbox.

- `contract/`: schemas, the folder rules (`deriveInsightInbox`), errors, the
  `InsightApi` token and the tRPC declaration.
- `process/`: the `insight_processing` pipeline, its two Postgres projections
  and the `InsightModule`.
- `browser/`: the Insights page, the top bar bell, the sidebar count and the
  "Save as insight" action on Langy answers.

An insight may point at the board and widget it came from, and keeps its
evidence as a query with fixed dates. Analytics lends the links and the chart
(ADR-002).

Behind the `release_insights` flag. Requirements: [specs](./specs/insight-inbox.feature).
Decisions: [ADRs](./adrs/README.md).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                      |
| Subjects       | insight                                                                                              |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                             |
| Api token      | `InsightApi` = `moduleApi<InsightApi>()("insight")`, `contract/src/insight.api.ts:26` (5 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                           |

## What insight owns

| Kind           | Name                      | Declared at                                                                         |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| Postgres table | `InsightProjection`       | `process/src/repositories/prisma/prisma.insight-projection.repository.ts:39`        |
| Postgres table | `InsightReaderProjection` | `process/src/repositories/prisma/prisma.insight-reader-projection.repository.ts:27` |
| Postgres table | `InsightProjection`       | `process/src/repositories/prisma/prisma.insight.repository.ts:12`                   |
| Postgres table | `InsightReaderProjection` | `process/src/repositories/prisma/prisma.insight.repository.ts:12`                   |

Anything else insight needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `projects`     | `ProjectApi`     | [project](../project/README.md)           |

## Who depends on insight

No module names insight as a peer.

<!-- readme:generated:end -->
