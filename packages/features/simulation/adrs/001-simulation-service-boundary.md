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

Simulation also owns the deterministic `simulation_run_execution` process,
wakes and intents. Intent execution calls the complete Scenario execution and
Simulation services; worker composition only registers the process.

## Public surfaces and transports

Existing REST URLs, tRPC names and Eventing type/version/key values remain
unchanged. Transports delegate to the composed service.

## Dependencies

Simulation consumes Scenario through `@langwatch/scenario-contract`. It does
not import Scenario server code or foreign repositories.

## Persistence

ClickHouse access remains private to the Simulation repository. Process state
and intent delivery remain in Eventing's durable stores.

## Runtime and registration

Boot composes one Simulation service. Worker composition registers the process
and binds its retry-safe intent executors once.

## Environment and configuration

The packages read no environment modules. Composition injects store and
execution capabilities.

## Errors

Required reads and commands return or throw. Only genuine optional reads use a
`try*` name. Intent failures propagate so the outbox can retry them.

## Contracts and validation

Zod 4 schemas define the existing Simulation events, process state, wakes and
intent payloads. Their wire names and versions are unchanged.

## Consequences

- Hono, tRPC and workers share one process-owned Simulation service.
- Only genuine optional reads use `tryGetScenarioRunData` and
  `tryGetBatchSummary`; ordinary reads and commands return or throw.
- Provider-specific message fields survive Zod validation.
- Existing REST/tRPC URLs and Eventing wire events remain unchanged.
