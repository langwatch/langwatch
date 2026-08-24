# ADR-001: Simulation has one read and execution service

**Status:** Accepted

**Behavioural contract:** [Simulation service](../specs/simulation-service.feature)

## Context

Simulation history came from an application-owned ClickHouse repository while
execution came from Eventing commands merged onto a second App object. Exports,
REST, tRPC, onboarding and workers could therefore reach different surfaces for
the same run lifecycle.

## Decision

`@langwatch/simulation-contract` owns the Zod 4 values and the one abstract
`SimulationService`. It covers the run, batch and set reads that callers use and
the run commands that the application actually dispatches.

`@langwatch/simulation-server` owns one private ClickHouse repository, an
injected windowed-read policy, an execution port and the concrete service. Boot
binds the execution port to the already registered Eventing commands and places
that service directly at `app.simulations`. A disabled analytical store uses the
null adapter but keeps command dispatch available.

CSV streaming remains an API composer because it owns HTTP/backpressure and
serialization policy. It receives `SimulationService`; it never receives or
reconstructs the private repository.

Scenario definitions, Suite run planning and the Eventing process manager keep
their own lifecycle ownership. They collaborate through services or the
execution port rather than creating another Simulation persistence path.

## Consequences

- Hono, tRPC and workers share one process-owned Simulation service.
- Only genuine optional reads use `tryGetScenarioRunData` and
  `tryGetBatchSummary`; ordinary reads and commands return or throw.
- Provider-specific message fields survive Zod validation.
- Existing REST/tRPC URLs and Eventing wire events remain unchanged.
