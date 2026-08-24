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
Suite-run and Simulation execution infrastructure. No Suite-local copy of a
foreign repository or service is permitted.

Boot constructs the service once at `app.suites`. REST and tRPC compatibility
transports call that instance for CRUD, reference checks, archived names and
run requests. Existing URLs and procedure names remain unchanged.

## Consequences

- Definition and run-plan behavior have one service boundary.
- Missing definitions and duplicate names use canonical domain errors.
- The Eventing Suite-run lifecycle remains durable infrastructure behind the
  execution port rather than a second public Suite capability.
