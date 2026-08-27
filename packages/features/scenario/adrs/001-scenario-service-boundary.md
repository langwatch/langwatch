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
portable Scenario Library and authoring UI. The service provides
required reads that throw `ScenarioNotFoundError` and explicit `try*` reads for
genuine optional discovery. Every operation accepts a project ID and the
private Prisma repository applies it to each query.

The server package owns its abstract repository and Prisma adapter. The process
composition root creates one `ScenarioService` and injects it into App. REST,
tRPC, workers and suite code consume only that contract; none construct a
repository or import the adapter.

## Public surfaces and transports

This slice owns authored scenario definitions, archive state, names, reference
classification, input mapping, templating, and the compact configuration read
required before execution.
Its web package owns portable library controls, table state, onboarding,
archive confirmation, target selection, the controlled form and parameter
controls. Application composition retains routes, tRPC, project context,
drawer submission and Langy row integration through explicit render ports.
Child-process execution is the separate worker lifecycle recorded in
[ADR-002](./002-scenario-execution-isolation.md). Scenario's run-lifecycle
collaborator owns the process manager; Suite owns orchestration; Trace owns
ingest-lag measurement. Scenario does not own exports, trace analytics or page
composition.

## Dependencies

Scenario consumes complete Agent, Model Provider, Project, Prompt, Secret,
Suite, Trace and Workflow contracts. It imports no foreign repository or
feature server implementation.

## Persistence

The private Prisma repository scopes every definition query by project. Run
state belongs to Scenario's private ClickHouse projections; execution intents
remain in Eventing stores.

## Runtime and registration

Boot creates one Scenario service. REST, tRPC, Suite and workers receive that
instance; no handler constructs another.

## Environment and configuration

Scenario packages read no environment module. Worker composition injects typed
execution, Redis and child-process configuration.

## Errors

Required reads throw `ScenarioNotFoundError`; only explicit `try*` discovery may
return null. Parameter validation throws portable handled domain errors.

## Contracts and validation

Zod 4 schemas define portable inputs, persisted values and transport payloads.
Generated Prisma types remain private to the repository adapter.

## Consequences

Old REST URLs and tRPC procedure names remain compatibility transports. The
application migration must wire `app.scenarios` once and replace legacy
per-request construction and repository imports. The legacy implementation can
then be deleted instead of being maintained in parallel.
