# ADR-001: Telemetry owns canonical log and metric pipelines

**Status:** Accepted

**Behavioural contract:** [Telemetry pipelines](../specs/telemetry-pipeline.feature)

## Decision

The singular Telemetry feature owns canonical OTLP log and metric preparation,
commands, event schemas, deterministic projections, rollups, and pipeline
installers. Portable values and event/command schemas live in
`@langwatch/telemetry-contract`; server pipeline implementations live in
`@langwatch/telemetry-server`.

The application remains the composition root. It supplies the existing
ClickHouse-backed repositories to the package's private append-store ports and
registers one log pipeline and one metric pipeline. Existing event types,
projection names and versions, shard derivation, retention stamping,
idempotency and OTLP isolation remain unchanged.

The trace pipeline consumes Telemetry contracts for log contributions and metric
correlations. Coding-agent subscribers consume the package exports from app
composition. Legacy Elasticsearch ingestion is outside this boundary and is
not migrated.

## Context

Canonical OTLP log and metric processing had been coupled to application
pipeline folders and persistence implementations. The extraction needs one
feature owner while preserving the existing eventing behaviour and transports.

## Public surfaces and transports

`@langwatch/telemetry-contract` exposes portable schemas, values, and the
`TelemetryService` capability. `@langwatch/telemetry-server` exposes the
concrete service and narrowly named process-composition pipeline adapters.
HTTP and tRPC routes remain application transports.

## Dependencies

The contract depends only on Zod. The server depends on the contract and
Eventing; it receives application repositories and other feature services
through explicit ports.

## Persistence

ClickHouse repository implementations remain application adapters. The server
owns private append stores and receives typed append ports. Elasticsearch is
outside this feature boundary.

## Runtime and registration

The app creates one `TelemetryService` per process and injects it into the
pipeline registry and OTLP collection services. It registers one
`log_processing` and one `metric_processing` pipeline; no request constructs a
service.

## Environment and configuration

Telemetry reads no environment modules. The app resolves shard counts and the
platform retention default at boot, then injects those semantic values into
the service and its private stores. `LANGWATCH_DEFAULT_RETENTION_DAYS` keeps
its existing development-only validation and semantics.

## Errors

Malformed OTLP records are isolated and reported through the existing partial
success result. Persistence failures remain retryable and are mapped by the
application transport; domain internals do not cross the HTTP boundary.

## Contracts and validation

Zod 4 schemas define command/event payloads and canonical records. Untrusted
OTLP JSON is parsed at the server boundary before canonicalisation. Existing
event names, versions, shard derivation, coalescing, projections and response
semantics remain unchanged.

## Consequences

There is one physical owner for canonical log and metric event processing, while
transport and persistence adapters remain process composition. No Telemetry
service is constructed per request and no package reads application
environment/configuration.
