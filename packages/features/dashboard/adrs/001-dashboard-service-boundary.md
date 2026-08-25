# ADR-001: One Dashboard service boundary

**Status:** Accepted

**Behavioural contract:** [Dashboard service](../specs/dashboard-service.feature)

## Decision

Dashboard owns the dashboard, builder graph, and saved LangWatchQL workbench
chart lifecycles. They share the `CustomGraph` persistence table, but each
repository operation filters its discriminator (`builder` or `workbench_sql`)
before mapping rows. A single process-owned `DashboardService` exposes all three
capabilities; compatibility tRPC, REST, and RPC routes delegate to that
service.

The server package owns one private Prisma repository for the shared
dashboard/chart lifecycle. It exposes no generated
Prisma records and does not import application transport code. Saved-chart
query and visualization governance is an injected policy port so the feature
can reuse the existing analytics validators without moving analytics into the
Dashboard package.

Every project-scoped lookup carries the project id into the repository. Missing
resources throw feature errors at the service boundary; nullable repository
lookups are named `try*`. The API process constructs one service instance and
passes it through application context.

## Consequences

The old dashboard, graph, and saved-chart URLs remain compatibility transports
while their handlers migrate. Analytics still owns query execution; Dashboard
owns the saved chart artifact and placement lifecycle. Dashboard does not own
automation trigger persistence even when a builder graph has an alert.
