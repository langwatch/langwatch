# dashboard

Dashboards and the graphs and saved workbench charts on them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | core (`modules/catalogue.json`)                                                                                |
| Subjects       | dashboard, graph, saved-workbench-chart                                                                        |
| Halves         | [contract](contract) · [process](process/README.md)                                                            |
| Api token      | `DashboardApi` = `moduleApi<DashboardApi>()("dashboard")`, `contract/src/dashboard.api.ts:336` (50 operations) |
| Installed by   | api, worker, tasks (process)                                                                                   |

## What dashboard owns

| Kind           | Name                        | Declared at                                                                |
| -------------- | --------------------------- | -------------------------------------------------------------------------- |
| Postgres table | `Dashboard`                 | `process/src/repositories/prisma/prisma.dashboard-widget.repository.ts:33` |
| Postgres table | `CustomGraph`               | `process/src/repositories/prisma/prisma.dashboard-widget.repository.ts:55` |
| Postgres table | `Dashboard`                 | `process/src/repositories/prisma/prisma.dashboard-widget.repository.ts:55` |
| Postgres table | `Dashboard`                 | `process/src/repositories/prisma/prisma.dashboard.repository.ts:105`       |
| Postgres table | `CustomGraph`               | `process/src/repositories/prisma/prisma.dashboard.repository.ts:105`       |
| Postgres table | `DashboardFavourite`        | `process/src/repositories/prisma/prisma.dashboard.repository.ts:105`       |
| Postgres table | `SavedView`                 | `process/src/repositories/prisma/prisma.saved-view.repository.ts:20`       |
| Config         | `publicBaseUrl` (BASE_HOST) | `contract/src/dashboard.config.ts:5`                                       |

Anything else dashboard needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name         | Token           | Module                                |
| ------------ | --------------- | ------------------------------------- |
| `analytics`  | `AnalyticsApi`  | [analytics](../analytics/README.md)   |
| `automation` | `AutomationApi` | [automation](../automation/README.md) |
| `projects`   | `ProjectApi`    | [project](../project/README.md)       |

## Who depends on dashboard

[onboarding](../onboarding/README.md), [ops](../ops/README.md) (as a peer).

<!-- readme:generated:end -->
