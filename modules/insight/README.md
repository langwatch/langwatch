# Insight

Owns insights: short findings about a project that Langy writes for one person.
An insight has one owner, the person whose Langy made it, and only the owner
reads it or acts on it (ADR-003).

- `contract/`: schemas, the folder rules (`deriveInsightInbox`), errors, the
  `InsightApi` token and the tRPC declaration.
- `process/`: the `insight_processing` pipeline, its two Postgres projections
  and the `InsightModule`; and the `insight_daily_run` pipeline, which carries
  out one daily run and keeps how each person's last run on a board ended.
- `browser/`: the Insights page, the top bar bell, the sidebar count, the
  "Save as insight" action on Langy answers and Copy, which is how an owner
  shares an insight.

An insight may point at the board and widget it came from, and keeps its
evidence as a query with fixed dates. Analytics lends the links and the chart
(ADR-002).

A daily run is Langy reading one board for one person and handing back
findings, which this module checks and files for that person. Langy only reads;
filing is the module's own write (ADR-004). An operator asks for a run with the
`insight-daily-run-request` task. No schedule wakes it yet.

Behind the `release_insights` flag. Requirements: [the inbox](./specs/insight-inbox.feature)
and [the daily run](./specs/insight-daily-run.feature). Decisions: [ADRs](./adrs/README.md).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                      |
| Subjects       | insight                                                                                              |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser)                             |
| Api token      | `InsightApi` = `moduleApi<InsightApi>()("insight")`, `contract/src/insight.api.ts:36` (7 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                           |

## What insight owns

| Kind           | Name                             | Declared at                                                                                 |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| Postgres table | `InsightDailyScheduleProjection` | `process/src/repositories/prisma/prisma.insight-daily-schedule-projection.repository.ts:28` |
| Postgres table | `InsightDailyScheduleProjection` | `process/src/repositories/prisma/prisma.insight-daily-schedule.repository.ts:10`            |
| Postgres table | `InsightProjection`              | `process/src/repositories/prisma/prisma.insight-projection.repository.ts:39`                |
| Postgres table | `InsightReaderProjection`        | `process/src/repositories/prisma/prisma.insight-reader-projection.repository.ts:27`         |
| Postgres table | `InsightProjection`              | `process/src/repositories/prisma/prisma.insight.repository.ts:22`                           |
| Postgres table | `InsightReaderProjection`        | `process/src/repositories/prisma/prisma.insight.repository.ts:22`                           |

Anything else insight needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name           | Token            | Module                                    |
| -------------- | ---------------- | ----------------------------------------- |
| `authz`        | `AuthzApi`       | [authz](../authz/README.md)               |
| `dashboards`   | `DashboardApi`   | [dashboard](../dashboard/README.md)       |
| `featureFlags` | `FeatureFlagApi` | [feature-flag](../feature-flag/README.md) |
| `langy`        | `LangyApi`       | [langy](../langy/README.md)               |
| `projects`     | `ProjectApi`     | [project](../project/README.md)           |
| `users`        | `UserApi`        | [user](../user/README.md)                 |

## Who depends on insight

No module names insight as a peer.

<!-- readme:generated:end -->
