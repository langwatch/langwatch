# ADR-001: Experiment owns saved experiments and runs

**Status:** Accepted

**Behavioural contract:** [Experiment service](../specs/experiment-service.feature)

## Context

Saved experiments, run history, DSPy steps, and batch-result behaviour had
separate app-local owners. That duplicated run shapes and made browser code
depend on server implementation types.

## Decision

Expose one `ExperimentService` for saved experiments, runs, durable run
commands, and DSPy steps. Keep portable result transformation, comparison
statistics, CSV serialisation, and controlled result state in the web package.

Experiment does not own Workflow or Monitor persistence. Archive compatibility
transports may coordinate those services after Experiment has fenced its own
row.

## Contracts and validation

The contract package defines Zod 4 commands, stored run values, handled-error
wire values, and concrete domain errors. The service parses commands before
calling persistence. Ordinary reads throw; polling and optional reads are
named `try*`.

## Public surfaces and transports

Existing REST and tRPC names and response shapes remain compatibility
transports over the process-owned service. Experiment web owns controlled
batch-result tables, sidebars, charts, leaderboards, CSV controls, and their
direct tests. App pages retain routing, tRPC hooks, rollout gates, page layout,
trace drawers, and image/evaluator/error render ports.

## Dependencies

Experiment consumes no other feature repository. Cross-feature archive work
stays in composition. The web package depends only on the Experiment contract
and browser-safe libraries; server and transport code do not import it.

## Persistence

Saved experiment rows use the private Prisma repository. Run history and DSPy
steps use private ClickHouse repositories. A deployment without ClickHouse
returns the documented optional run-read result rather than exposing a storage
client to callers.

## Runtime and registration

Each process creates one Experiment service at boot and supplies it through the
composed App. Request handlers and workers do not construct repositories or
register the feature at import time.

## Environment and configuration

The feature reads no environment variables. Database clients, ClickHouse
resolution, telemetry, clocks, IDs, and durable execution are injected by the
process composition.

## Errors

Required experiment and DSPy reads throw `ExperimentNotFoundError` and
`ExperimentDspyStepNotFoundError`. Archived rows cannot be revived through
save. Storage and durable-execution failures retain their concrete causes.

## Consequences

There is one service graph and one browser implementation of result behaviour.
Slug conflicts remain retried by the service, and no Experiment repository
writes another feature's table. App compatibility files are routing or process
composition only.
