# ADR-002: Scenario owns isolated execution preparation and lifecycle

**Status:** Accepted

**Behavioural contract:** [Scenario execution](../specs/scenario-execution.feature)

## Context

Scenario execution previously crossed application helpers for persistence,
secrets, model preparation, trace lag, process management and child spawning.
That produced several partial service contracts and made tenant isolation
depend on whichever helper a caller happened to use.

## Decision

The Scenario server package owns execution prefetch, its bounded process pool,
failure completion, cancellation subscription and the isolated child lifecycle.
It consumes complete Project, Suite, Prompt, Agent, Workflow, Model Provider,
Secret, Trace and Simulation services. Simulation owns the deterministic
run-execution process manager and calls Scenario through its execution service.
`ScenarioExecutionService` is the narrow second public service because
preparation, queue submission and cancellation share a worker lifecycle
distinct from CRUD. Transports, process managers and workers use that one
contract; the internal prefetch collaborators are not application services.

The worker composes one pool, one prefetcher and one processor. App code only
adapts process metrics, Redis and typed boot configuration.

Execution preparation exposes the project-scoped child environment separately
from the complete payload. The processor starts the isolated child as soon as
that environment is ready, while target and model preparation continue, and
sends no job data until the full preparation succeeds. A failed or cancelled
preparation aborts the already-started child.

Each run executes in a fresh child process with a separately initialised OpenTelemetry
provider. The parent passes only a narrow system allowlist and values derived for
that project. It never inherits parent OTLP configuration, trace context,
`NODE_OPTIONS` or ambient `LANGWATCH_*` values. The project API key and endpoint
prepared for the run are authoritative. The child flushes its own provider before
exit so one run cannot export through another run's provider.

## Consequences

Execution code reads no database, environment module or global application.
Persisted payloads and workflow DSL are parsed with Zod 4. Existing process
names, intent keys, retry behaviour, cancellation semantics and child wire
payload remain unchanged.
