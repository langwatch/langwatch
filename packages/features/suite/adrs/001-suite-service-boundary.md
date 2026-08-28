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

The `suite/web` surface owns browser-safe run presentation primitives that are
independent of routing and transport: scenario message previews, status
configuration/overlay, and the simulation card shell. The application retains
run-history page composition, tRPC hooks, Langy targeting, and prefetch wiring.

## Public surfaces and transports

The contract publishes the Suite vocabulary, its errors and one abstract
`SuiteService`. The server package publishes its composition adapter, the
execution port and service, the run commands, the run-processing pipeline
factory and the projection versions those two share. The web package publishes
browser-safe run presentation primitives. Suite mounts no route: the `/api/suites`
REST application and the `suites` tRPC router are compatibility transports over
the composed instance.

## Dependencies

The contract depends on the Scenario contract, the shared handled-error package
and Zod. The server depends on that contract and on the Agent, Prompt and
Scenario contracts for reference resolution, on the Eventing package for the
projection and fold types its run-state store implements, on the shared
observability logger, and on the generated Prisma client. The web package
depends on the Suite and Scenario contracts and browser libraries only.

## Persistence

Suite definitions live in the `SimulationSuite` table behind a private Prisma
repository. Run state and batch history live in ClickHouse behind a second
private repository that owns the latest-row tuple queries and the default-set
compatibility filter, and the composition adapter exposes only the projection
store capability that the Eventing pipeline needs. When no ClickHouse client is
resolved, an explicit in-memory repository accepts projection writes and returns
no run state, so a deployment without the read model is visibly empty rather
than quietly wrong.

## Runtime and registration

Process composition builds one adapter from the Prisma client, the canonical
Agent, Prompt and Scenario services, an optional ClickHouse client resolver, the
platform retention default, an execution service bound to the durable run
commands and an identifier generator; the built service is exposed on the
application context. The application also registers the Suite run-processing
pipeline with the shared Eventing registry, using a fold store over that same
run-state repository, so there is one repository instance rather than two.
Registration happens in every process; only worker-capable roles consume the
resulting jobs.

## Environment and configuration

Suite packages read no environment value. The ClickHouse resolver, the retention
default, the identifier generator and every collaborating service are
constructor arguments, which is also what lets the in-memory variant exist
without a second code path inside the feature.

## Errors

A missing definition and a duplicate name throw the canonical not-found error
and `suite_name_taken`. Everything a run plan can reject has its own code on a
shared execution error: `suite_invalid_scenario_references`,
`suite_invalid_target_references`, `suite_all_scenarios_archived`,
`suite_all_targets_archived`, `suite_targets_required`, `suite_scope_empty` and
`suite_scope_not_allowed`. Managed folder membership throws the shared
validation error, so the transport can return the rejection against the field
the caller sent.

## Contracts and validation

Zod 4 schemas define the Suite definition, its references, the run request and
the run-state projection data. The projection versions are published from the
contract, so the pipeline that writes a fold and the repository that reads it
cannot disagree about the shape on disk.

## Consequences

- Definition and run-plan behavior have one service boundary.
- Run-state and batch-history reads have the same service boundary as run
  preparation; the old app-layer read repository is only a migration seam.
- Missing definitions and duplicate names use canonical domain errors.
- The Eventing Suite-run lifecycle remains durable infrastructure behind the
  execution port rather than a second public Suite capability.
