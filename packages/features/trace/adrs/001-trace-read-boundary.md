# ADR-001: Trace owns reads, ingestion and deterministic processing

**Status:** Accepted

**Behavioural contracts:** [Trace read service](../specs/trace-read-service.feature),
[query language](../specs/trace-query-language.feature), and
[canonicalisation](../specs/sdk-timing-and-metrics-canonicalisation.feature)

## Context

Trace reads and processing used to be implemented across app routers, app-layer
services and the event-sourcing pipeline. That duplicated the feature boundary
and made transport, replay and projection parity difficult to prove.

## Decision

Trace owns portable read, ingress and processing contracts plus the server
implementation behind them. The app owns authentication, transport mapping and
process composition.

The canonical `TraceService` owns the characterized read methods: trace records,
derived events, evaluation spans/events, paged span trees, row-version deltas,
query-field catalogues, query classification, ingest-wait timing and summary
lookup. Zod 4 schemas preserve the existing transport fields and nullability.
The app's URLs and tRPC names do not change.

Trace also owns OTLP traversal and validation, the portable ingestion age limit,
command and event definitions, canonicalisation, and the deterministic
`trace_processing` pipeline. The server package contains the trace-summary and
trace-analytics folds, stored-span and timeseries-rollup map projections, their
stores, and their pure derivation collaborators.

## Composition and effects

Composition roots create one Trace service, ingestion service, canonicalisation
service and processing graph per process. They inject ClickHouse resolution,
deduplication, spool/blob access, privacy preparation, tokenization, pricing,
media extraction and projection storage through named ports.

Cross-feature and external effects remain app or owning-feature adapters. These
include evaluation and automation dispatch, project metadata updates,
simulation/experiment synchronization, governance subscribers and live UI
broadcasts. They subscribe to the package-owned graph and do not reimplement its
commands or projections.

## Persistence and query parity

Paged trees and row-version deltas read `stored_spans`. A bounded
`trace_summaries` lookup may supply the first-page occurrence hint; a stale hint
falls back to an unbounded tenant-scoped read. `trace_analytics`,
`trace_summaries` and the timeseries rollup are distinct projections and are
never substituted for one another. Trace ingestion does not write to
Elasticsearch.

The ClickHouse implementation stays private to the server package. Tenant id is
carried to every persistence call. Cost redaction happens after persistence and
before DTO validation; missing positive stored cost delegates to the complete
Model Provider service.

## Compatibility gates

Authenticated handlers use the composed service through `context.app` or
`ctx.app`. Missing traces retain each existing route's successful-empty or
not-found mapping. Invalid cursors and inputs still fail contract validation,
and persistence errors keep their existing transport mapping.

Legacy full-detail and list/search composition remains authoritative wherever
the package service still enters through an app adapter. Those adapters may
resolve visibility protections, annotations, evaluations, enrichment, links,
events and blob-backed payloads, but must contain no second Trace domain
implementation. A residual moves only with a fixture proving its complete
response, authorization, ordering, pagination and null-versus-omitted parity.

## Browser boundary

The web package owns reusable, transport-neutral presentation and loaded-row
behaviour. The app supplies routing, data hooks and small named render ports for
media, terminal and anchored-comment UI. Browser code does not authorize,
compose services or reshape Trace responses.

## Consequences

Displaced app command, projection, schema and store modules are deleted once
their package coverage is canonical. Remaining app modules are explicit
transport, composition or external-effect adapters; they are not a second
processing stack.
