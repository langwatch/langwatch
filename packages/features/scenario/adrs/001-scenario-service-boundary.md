# ADR-001: Scenario owns scenario definitions and durable CRUD

**Status:** Accepted

**Behavioural contract:** [Scenario service](../specs/scenario-service.feature)

## Context

Scenario definitions, parameter vocabulary and their Prisma repository were
previously application modules. REST and tRPC handlers constructed a service
per request, while suite and simulation code reached the repository directly.
That makes the simple, tenant-scoped definition domain hard to reuse without
also importing application infrastructure.

## Decision

`scenario` owns the definition model, Zod 4 parameter schemas, one abstract
`ScenarioService`, portable input-mapping and template-rendering values, and
portable Scenario Library UI. The service provides
required reads that throw `ScenarioNotFoundError` and explicit `try*` reads for
genuine optional discovery. Every operation accepts a project ID and the
private Prisma repository applies it to each query.

The server package owns its abstract repository and Prisma adapter. The process
composition root creates one `ScenarioService` and injects it into App. REST,
tRPC, workers and suite code consume only that contract; none construct a
repository or import the adapter.

## Boundaries

This slice owns authored scenario definitions, archive state, names, reference
classification, input mapping, templating, and the compact configuration read
required before execution.
Its web package owns portable library controls, table state, onboarding, archive
confirmation and target selection. Application composition retains routes,
tRPC, project context and Langy row integration through explicit render ports.
It does not own child-process execution, simulator runs, Eventing process
managers, suite orchestration, exports, trace metrics or page composition.
Those remain their current feature/application owners until each can consume
the service contract instead of persistence directly.

## Consequences

Old REST URLs and tRPC procedure names remain compatibility transports. The
application migration must wire `app.scenarios` once and replace legacy
per-request construction and repository imports. The legacy implementation can
then be deleted instead of being maintained in parallel.
