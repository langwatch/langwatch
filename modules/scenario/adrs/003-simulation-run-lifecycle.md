# ADR-003: Scenario owns the simulation run lifecycle

**Status:** Accepted

**Behavioural contract:** [Simulation service](../specs/simulation-service.feature)

## Context

Simulation history came from an application-owned ClickHouse repository while
execution came from Eventing commands merged onto a second App object. Exports,
REST, tRPC, onboarding and workers could therefore reach different surfaces for
the same run lifecycle.

## Decision

Scenario and Simulation are one product domain. `@langwatch/scenario-contract`
owns both authored scenario values and the existing Simulation run vocabulary.
The run lifecycle remains a separate internal collaborator because it uses a
durable process manager and ClickHouse projections rather than Scenario's
authoring repository.

`@langwatch/scenario-server` owns one private ClickHouse repository, an
injected windowed-read policy, an execution port and the concrete service. Boot
binds the execution port to the already registered Eventing commands and places
that service directly at `app.simulations`. A disabled analytical store uses the
null adapter but keeps command dispatch available.

CSV streaming remains an API composer because it owns HTTP/backpressure and
serialization policy. It receives `SimulationService`; it never receives or
reconstructs the private repository.

The feature owns the deterministic `simulation_run_execution` process, wakes
and intents. Intent execution calls the complete Scenario execution and run
lifecycle services; worker composition only registers the process.

## Public surfaces and transports

Existing REST URLs, tRPC names and Eventing type/version/key values remain
unchanged. Transports delegate to the composed service.

## Dependencies

Other features consume this domain through `@langwatch/scenario-contract`.
They do not receive its repositories or import Scenario server code.

## Persistence

ClickHouse access remains private to the Scenario feature's run repository.
Process state and intent delivery remain in Eventing's durable stores.

## Runtime and registration

Boot composes one Scenario feature graph. Worker composition registers the run
process and binds its retry-safe intent executors once.

## Environment and configuration

The packages read no environment modules. Composition injects store and
execution capabilities.

## Errors

Required reads and commands return or throw. Intent failures propagate so the
outbox can retry them. Existing nullable reads are migration debt and no new
nullable finder is introduced by this ownership change.

## Contracts and validation

Zod 4 schemas define the existing Simulation events, process state, wakes and
intent payloads. Their wire names and versions are unchanged.

## Consequences

- Hono, tRPC and workers share one process-owned Scenario feature graph.
- Provider-specific message fields survive Zod validation.
- Existing REST/tRPC URLs and Eventing wire events remain unchanged.
