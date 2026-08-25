# ADR-001: Suite owns definitions and run planning

**Status:** Accepted

**Behavioural contract:** [Suite service](../specs/suite-service.feature)

## Context

Suite definition CRUD, reference resolution and run planning were split between
two application services. Both reached Scenario or Suite persistence directly,
and transports constructed the definition service per request.

## Decision

`@langwatch/suite-contract` owns the portable Zod 4 Suite vocabulary and one
abstract `SuiteService`. `@langwatch/suite-server` owns its private Prisma
repository and concrete service.

The service receives the canonical Agent, Prompt and Scenario services for
cross-feature resolution. It receives a narrow execution port for scheduling a
resolved run; application composition binds that port to the existing durable
Suite-run and Simulation execution infrastructure. It also exposes run state
and batch history through a private `SuiteRunRepository`; the ClickHouse
adapter owns the latest-row tuple queries and the default-set compatibility
filter. `PostgresSuiteAdapter.eventing()` exposes only the projection-store
capability needed by Eventing, backed by the same repository instance. No
Suite-local copy of a foreign repository or service is permitted.

The adapter selects ClickHouse or an explicit in-memory repository. The latter
supports Eventing projection writes but keeps Suite service reads empty because
there is no durable read model available.

Boot constructs the service once at `app.suites`. REST and tRPC compatibility
transports call that instance for CRUD, reference checks, archived names and
run requests. Existing URLs and procedure names remain unchanged.

## Consequences

- Definition and run-plan behavior have one service boundary.
- Run-state and batch-history reads have the same service boundary as run
  preparation; the old app-layer read repository is only a migration seam.
- Missing definitions and duplicate names use canonical domain errors.
- The Eventing Suite-run lifecycle remains durable infrastructure behind the
  execution port rather than a second public Suite capability.
