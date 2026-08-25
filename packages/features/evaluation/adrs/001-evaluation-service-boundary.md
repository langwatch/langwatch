# ADR-001: Evaluation owns execution and evaluation runs

**Status:** Accepted

**Behavioural contract:** [Evaluation service boundary](../specs/evaluation-service.feature)

## Context

Evaluation execution, run persistence and compatibility transports are spread
across application services. Workers and API handlers currently know separate
run and execution implementations, which makes it possible to construct
dependencies more than once or bypass feature boundaries.

## Decision

Create one canonical `EvaluationService` capability. It owns evaluation
execution-facing behaviour, durable evaluation-run reads/writes, per-trace
evaluation/inputs reads, and monitor-performance summaries. Evaluator owns evaluator
definitions; Workflow owns workflow definitions and version selection; Trace
supplies trace data through the injected execution adapter.

## Contracts and validation

Portable run, summary, command and result values use Zod 4. The service parses
commands at its boundary and returns values or throws concrete errors.

## Persistence

Evaluation persistence is private to the server package. One ClickHouse
repository owns runs, summaries, per-trace reads and deferred inputs; a second
private repository owns the monitor-performance query. The trace reader retries
without the heavy `Inputs` column when the first read exceeds ClickHouse
memory. An injected input-resolution port resolves durable ADR-040 markers at
the Evaluation read boundary. `EvaluationAdapter` constructs the repositories.

## Dependencies

The service receives the canonical Workflow service because it directly
checks workflow ownership before dispatch. The actual trace, evaluator,
dataset, native-evaluator, Langevals and workflow-execution machinery remains
behind the existing execution implementation while those feature contracts
are extracted. The Evaluation adapter does not accept unused speculative
dependencies merely because execution may need them internally later.

## Public surfaces and transports

Existing tRPC, REST and event-sourcing transports keep their names. Projections,
replay, monitor performance and trace-result reads use the flat
`app.evaluations` capability. Manual evaluation still uses the protected Trace
reader because worker execution intentionally has internal visibility; that
transport moves only after Trace access policy becomes a portable input. The
arbitrary-data REST runner remains an explicit migration seam.

## Runtime and registration

The application creates one `EvaluationAdapter` at process boot and
passes its service to API and worker contexts. No request handler creates a
repository or execution client.

## Environment and configuration

The feature does not read environment variables. ClickHouse resolution,
retention, trace access and evaluator execution configuration are injected.

## Errors

`EvaluationNotFoundError` is thrown when a run lookup has no result.
Configuration and execution failures remain concrete errors until the
transport maps them to its compatibility envelope.

## Consequences

API, workers and projections share one evaluation capability while ClickHouse
and execution infrastructure remain replaceable. The old nested `runs`,
`execution`, `performance` and `traceEvaluations` App shape is removed.
