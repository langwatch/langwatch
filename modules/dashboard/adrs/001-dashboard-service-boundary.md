# ADR-001: One Dashboard service boundary

**Status:** Accepted

**Behavioural contract:** [Dashboard service](../specs/dashboard-service.feature)

## Context

Dashboards, builder graphs and saved LangWatchQL workbench charts were three
lifecycles reached from three different transports, each holding its own
persistence access. They share one table and one placement model, so splitting
them across transports made a chart appear or disappear depending on which route
a caller used.

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

## Public surfaces and transports

The contract publishes the dashboard, graph and saved-chart values, their
errors, and one abstract `DashboardService`. The server package publishes the
composition adapter plus the three injection points the host fills: the
identifier generator, the graph visibility policy and the saved-chart policy.
The feature mounts no route of its own. The `dashboards`, `graphs` and
saved-workbench-chart tRPC routers, the `/api/dashboards` and `/api/graphs` REST
applications, and the saved-chart routes under `/api/v1/projects` are host
transports over the composed service.

## Dependencies

The contract depends on the Analytics contract for the workbench query and
visualization vocabulary, on the shared handled-error package, and on Zod. The
server depends on that contract, on the Analytics contract for the governance
types its policy port accepts, and on the generated Prisma client. Dashboard
depends on no other feature and never executes an analytics query itself.

## Persistence

One private Prisma repository owns the `Dashboard` and `CustomGraph` tables.
Builder graphs and saved workbench charts share `CustomGraph`, so every
operation filters its own discriminator before it maps a row. Every
project-scoped call carries the project identifier into the repository, and no
generated Prisma record leaves the server package.

## Runtime and registration

Process composition builds one adapter from the Prisma client, an identifier
generator and a saved-chart policy bound to the existing analytics validator
using the project's protections, then exposes the built service on the
application context. Importing the feature registers nothing: Dashboard owns no
worker job, subscriber or event pipeline, so one instance serves every process
role.

## Environment and configuration

Dashboard packages read no environment value. The identifier generator, the
saved-chart policy and the database client are constructor arguments supplied at
composition.

## Errors

A missing dashboard, graph or saved chart, a reorder naming identifiers that do
not exist, a saved chart created under an identifier already taken, and a stored
chart definition that no longer parses each throw their own concrete error,
which the transports map to their existing responses. A rejected
saved-chart definition throws the shared validation error carrying field and
form errors, so a transport can return the rejection against the offending
fields rather than as prose.

## Contracts and validation

Zod 4 schemas define every dashboard, graph and saved-chart input and output.
Repository rows are parsed before they leave the boundary, and a stored chart
definition is parsed again when it is presented, so an unreadable one is
reported by identifier rather than returned.

## Consequences

The old dashboard, graph, and saved-chart URLs remain compatibility transports
while their handlers migrate. Analytics still owns query execution; Dashboard
owns the saved chart artifact and placement lifecycle. Dashboard does not own
automation trigger persistence even when a builder graph has an alert.
