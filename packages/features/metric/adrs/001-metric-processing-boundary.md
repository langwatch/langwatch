# ADR-001: Metric owns canonical OTLP metric processing

**Status:** Accepted

**Behavioural contract:** [Metric processing](../specs/metric-processing.feature)

**Related:** [Singular feature ownership](../../../../dev/docs/adr/112-singular-feature-ownership.md),
and [feature package boundaries](../../../architecture-lint/adrs/001-feature-package-boundaries.md).

## Context

OpenTelemetry metrics have an independent intake, canonical data-point,
durable event, series, and rollup lifecycle. The `metric` feature has contract
and server surfaces for that vertical slice. The shared OTLP ingestion record
is retained as migration context; ownership of metric behaviour is specific to
this feature.

## Decision

`metric` owns validation, PII redaction, lossless canonicalisation, exemplar
correlation extraction, durable eventing, and the existing-table projections
for canonical OTLP metric points. `@langwatch/metric-contract` owns portable Zod 4
values, schemas, commands, events, and the single ordinary-caller
`MetricService`; `@langwatch/metric-server` owns the concrete service,
processing pipeline, private stores, rollup logic, and adapters.

The pipeline records each canonical point with the existing
`lw.obs.metric.data_point_received` event (version `2026-07-15`), `metric`
aggregate, `pointId` aggregate identity, tenant-scoped idempotency key, shard
routing, and append-coalescing limits. The existing projections preserve
`metricDataPointStorage`, `metricSeriesCatalog`, and `metricTimeRollup` and
their four ClickHouse tables: `metric_data_points`, `metric_usage_estimates`,
`metric_series`, and `metric_time_rollups`. Time rollups remain deterministic
30-second buckets (`30_000` ms), including their existing sequence,
temporality, gap, and reset semantics.

Trace is not a horizontal log/metric service. Process composition may dispatch
only a valid metric exemplar correlation to Trace; Trace owns the resulting
trace correlation fold. That call uses the Trace contract only, does not
import Trace persistence or construct a shared service, and cannot replace or
delay durable metric-point storage.

### Public surfaces and transports

The contract exports canonical metric points, correlation values, commands,
events, rollup values, constants, and `MetricService`. The server root exposes
only the process runtime and shard configuration rule; its concrete service,
repositories, stores, processing, and rollup adapters remain private. Existing
OTLP HTTP and internal transports remain process adapters. Until their process
cutover, those app adapters retain request traversal, command dispatch,
partial-success mapping, and Trace contribution wiring; this ADR does not claim
those residuals are package code.

### Dependencies

The contract depends on Zod 4. The server depends on Eventing and injected
redaction, ClickHouse, retention, and process-composition capabilities. Trace
is reached only through its portable metric-correlation contract; Metric
imports no Trace server, repository, or cross-domain implementation.

### Persistence

The private ClickHouse repository preserves the existing four tables:
`metric_data_points` is authoritative canonical storage,
`metric_usage_estimates` is the payload-free usage projection,
`metric_series` is the series catalog, and `metric_time_rollups` stores the
30-second derived buckets. `seriesId` is deterministic over series identity;
`pointId` is deterministic over series identity and canonical payload. Raw
writes precede derived writes, and repository failures are rethrown so the
existing worker retry policy can retry the same idempotent work.

### Runtime and registration

Application or worker composition creates one `MetricRuntimeAdapter` per
process. It owns the private repository, complete metric processing pipeline,
retention default, shard count, and optional Trace correlation subscriber.
Importing the packages registers nothing, and request handlers do not construct
services.

### Environment and configuration

The feature reads no environment modules. Boot composition validates the
retention default, redaction policy, ClickHouse resolvers, and shard count and
injects those semantic values and adapters.

### Errors

Malformed metric containers, unsupported kinds, malformed points, and
canonical payloads over the existing 256 KiB limit are rejected per point.
Valid siblings remain accepted and the existing OTLP partial-success count and
error mapping are preserved. Durable persistence errors remain retryable.
Invalid or absent exemplars produce no Trace correlation and do not reject the
canonical metric point.

### Contracts and validation

Zod 4 validates untrusted request-derived values before commands and event
replay. Canonical points preserve typed numeric values, resource/scope/point
attributes, metric kind and temporality, timestamps, exemplars, redaction
level, and canonical payload bytes. Existing event names, version, point and
series IDs, shard identity, coalescing, idempotency, four table mappings,
30-second rollups, and response semantics remain unchanged.

## Consequences

Metric has one owner for canonical preparation, durable processing, and one
canonical point model. Trace can expose exemplar-linked correlations without
owning metric storage or rollups. The four existing tables, 30-second rollup
semantics, partial success, and queue retry behaviour remain stable; transport
traversal and response mapping remain a named composition residual until
process cutover.
