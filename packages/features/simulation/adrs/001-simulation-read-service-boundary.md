# ADR-001: Simulation owns run-history reads

**Status:** Accepted

**Behavioural contract:** [Simulation read service](../specs/simulation-read-service.feature)

## Context

Run history is read by REST, tRPC, exports, onboarding and product surfaces.
The ClickHouse implementation had been exposed through application-layer types,
making a transport or neighbouring feature able to depend on simulation
persistence directly.

Simulation execution is separately owned by the eventing process manager in
[ADR-094](../../../../dev/docs/adr/094-simulation-execution-on-process-manager-substrate.md).
That decision remains unchanged.

## Decision

`@langwatch/simulation-contract` owns Zod 4 wire values and the abstract
`SimulationService`. `@langwatch/simulation-server` owns its repository port,
the null implementation used when the analytical store is unavailable, and the
concrete service. Callers receive the abstract service; only Simulation's boot
composition knows its repository.

The existing ClickHouse repository, windowed-read metering, REST handlers,
scenario authoring, suite composition and execution process remain application
integration seams until their owning features have corresponding package
surfaces. They are not copied into this package merely because they mention a
simulation.

## Contracts and validation

The contract uses Zod 4 schemas for run, batch and set records. The concrete
service parses repository results before returning them. Repository ports stay
private to the server package; the public dependency is the abstract service.

## Dependencies

The read service depends only on Simulation's repository port. It does not use
foreign repositories, global App access, or transport code.

## Persistence

The existing ClickHouse implementation remains the persistence adapter. Its
windowed-read telemetry is an application composition concern until the
ClickHouse client and metrics boundary move together.

## Runtime and registration

Boot creates the repository and one `SimulationService`; request handlers use
the process App injected into Hono context. No handler constructs a service.

## Public surfaces and transports

Existing REST and tRPC names/URLs remain compatible. The REST simulation-runs
handler now reads its service through `context.app`, not a global singleton.

## Environment and configuration

The feature reads no environment variables. ClickHouse availability is decided
at boot, which selects the ClickHouse or null repository.

## Errors

The two reads that genuinely branch on absence are explicitly named
`tryGetScenarioRunData` and `tryGetBatchSummary`. Invalid persisted values fail
Zod validation at the canonical service boundary rather than leaking malformed
records to a transport.

## Consequences

- run-history values are portable, validated Zod 4 contract values;
- REST/tRPC/worker migrations can reuse one read capability without learning
  ClickHouse details;
- export can remain a dedicated streaming capability while accepting only
  Simulation's repository at boot; and
- the eventing lifecycle and scenario configuration retain their existing
  owners, avoiding a synthetic catch-all Simulation package.
