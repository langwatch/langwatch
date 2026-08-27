# ADR-001: Log owns canonical OTLP log processing

**Status:** Accepted

**Behavioural contract:** [Log processing](../specs/log-processing.feature)

**Related:** [Singular feature ownership](../../../../dev/docs/adr/112-singular-feature-ownership.md),
and [feature package boundaries](../../../architecture-lint/adrs/001-feature-package-boundaries.md).

## Context

OpenTelemetry logs have an independent intake, canonical record, durable
event, and storage lifecycle. The `log` feature has contract and server
surfaces for that vertical slice. The shared OTLP ingestion record is retained
as migration context; ownership of log behaviour is specific to this feature.

## Decision

`log` owns validation, PII redaction, lossless canonicalisation,
correlation-id derivation, durable eventing, and the existing-table
projections for canonical OTLP log records. `@langwatch/log-contract` owns portable Zod 4
values, schemas, commands, events, and the single ordinary-caller
`LogService`; `@langwatch/log-server` owns the concrete service, processing
pipeline, private stores, and adapters.

The pipeline records each canonical record with the existing
`lw.obs.log.record_received` event (version `2026-07-17`), `log` aggregate,
`recordId` aggregate identity, tenant-scoped idempotency key, shard routing,
and append-coalescing limits. `canonicalLogStorage` projects the event to the
existing `log_records` and `log_usage_estimates` tables. These names, IDs,
retention stamping, ordering, and retry behaviour are compatibility
requirements.

Trace is not a horizontal log/metric service. Process composition may dispatch
a valid correlated canonical log to Trace as a compact trace contribution;
Trace owns the resulting trace fold. That call uses the Trace contract only,
does not import Trace persistence or construct a shared service, and is
best-effort: failure to contribute does not discard the durable canonical log.

### Public surfaces and transports

The contract exports canonical log records, the trace-correlated read shape,
command/event schemas, constants, and `LogService`. The server root exposes
only the process runtime and shard configuration rule; its concrete service,
repositories, stores, and pipeline adapters remain private. Existing OTLP HTTP
and internal transports remain process adapters over the composed service.
Until their process cutover, those app adapters retain request traversal, command dispatch,
partial-success mapping, and Trace contribution wiring; this ADR does not claim those
residuals are package code.

### Dependencies

The contract depends on Zod 4. The server depends on Eventing and injected
redaction, ClickHouse, retention, and process-composition capabilities. Trace
is reached only through its portable contribution contract; Log imports no
Trace server, repository, or cross-domain implementation.

### Persistence

The private ClickHouse repository writes canonical rows to `log_records` and
the payload-free usage rows to `log_usage_estimates`. `recordId` is the
deterministic 64-hex canonical content identity and remains the event
aggregate identity. Repository failures are rethrown so the existing worker
retry policy can retry the same idempotent work.

### Runtime and registration

Application or worker composition creates one `LogRuntimeAdapter` per process.
It owns the private repository, complete `LogService`, retention default,
shard count, and processing pipeline. Importing the packages registers nothing,
and request handlers do not construct services.

### Environment and configuration

The feature reads no environment modules. Boot composition validates the
retention default, redaction policy, ClickHouse resolver, and shard count and
injects those semantic values and adapters.

### Errors

Malformed records and canonical payloads over the existing 1 MiB limit are
rejected per record. Valid siblings remain accepted and the existing OTLP
partial-success count and error messages are preserved. Durable persistence
errors remain retryable; best-effort Trace contribution errors do not turn an
accepted canonical log into a failed durable write.

### Contracts and validation

Zod 4 validates untrusted request-derived values before commands and event
replay. Canonical records preserve typed bodies, attributes, provider fields,
wire IDs, synthesized correlation IDs, timestamps, redaction level, and
canonical payload bytes. Existing event names, version, shard identity,
coalescing, idempotency, table mappings, and response semantics remain
unchanged.

## Consequences

Log has one owner for canonical log preparation, durable processing, and
storage. Trace can enrich traces without owning log storage, and a Trace outage
cannot erase accepted logs. Transport traversal and response mapping remain a
named composition residual until process cutover; ClickHouse wiring stays in
composition.
