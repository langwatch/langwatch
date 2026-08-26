# ADR-001: Trace owns the viewer-safe span-tree read boundary

**Status:** Accepted

**Behavioural contract:** [Trace read service](../specs/trace-read-service.feature)

## Context

The app owned paged span-tree reads, row-version delta reads and their
ClickHouse queries. That duplicated Trace ownership while making transport
parity difficult to prove.

## Decision

The Trace feature owns these reads through its canonical service and private
persistence boundary. The app retains only transport and composition.

## Public surfaces and transports

Trace owns the live `tracesV2.spanTreePaginated` and `tracesV2.spanTreeDelta`
reads. The portable contract uses Zod 4 schemas and preserves every field and
nullish optionality in those responses. Every read carries the tenant/project
id to persistence. A missing trace returns an empty page with a null cursor.

The app's tRPC names and response shapes do not change. Browser code may use
the Trace contract but does not fetch or reshape the response.

The contract also owns the portable Trace query language: field metadata,
grammar, parsing, analysis and mutations. Browser callers execute these pure
operations locally. Live categorical samples are read through `TraceService`;
the server keeps the facet source behind a private composition port.

## Dependencies

`TraceService` receives the Trace repository and the complete Model Provider
service. Missing positive stored cost delegates to the latter's canonical
pricing cascade; Trace does not implement another calculator.

## Persistence

The server keeps one private Trace repository. Its ClickHouse implementation
is composed by the server adapter and never crosses the package export
boundary. Cost redaction is applied after persistence reads and before DTO
validation.

Paged and delta reads use `stored_spans`. `trace_summaries` may provide the
first-page occurrence hint; `trace_analytics` and its time-series rollup are
not substitutes.

## Runtime and registration

The app composition root creates one Trace service and exposes it through
`context.app`. Request handlers do not construct repositories or services.

Canonicalisation has a separate synchronous, deterministic lifecycle from the
asynchronous tenant read service. One process-owned
`TraceCanonicalisationService` is shared by trace summary, trace analytics,
span storage and timeseries rollup projections, and by log and coding-agent
callers. Its format adapters are private implementation details.

## Environment and configuration

Trace reads no environment variables. The ClickHouse client and semantic
configuration arrive through composition.

## Errors

Invalid cursors and inputs fail contract validation. Persistence failures
propagate through the existing transport error mapping. A missing trace is a
successful empty page, preserving the existing API.

## Contracts and validation

Zod 4 schemas define input, cursor and response DTOs. Service output is parsed
before crossing the transport boundary, including nullish field behaviour.

## Consequences

Portable response schemas now live in the Trace contract and the legacy router
schema module is only a re-export. This slice does not move the corresponding
header, full/detail, list/search, resource or signal reads, nor their app-owned
projection/eventing implementations, overlays, evaluations, enrichment or
logs. Canonicalisation itself is shared by the four existing projections and
the trace/log/coding-agent readers.
The browser package contains only display behaviour and cannot fetch,
authorize, compose, or reshape a trace response. It also owns the
transport-neutral loaded-row find behaviour and the flame-graph presentation.
The transcript stack (content parsing, turn grouping, role presentation,
reasoning/tool cards, and the virtualized conversation list) is likewise
browser-safe and reusable. The app supplies only the media, terminal, and
anchored-comment render ports needed by its concrete drawer.
The app supplies loaded span rows, selection callbacks, its Kbd skin, and
shortcut composition; a small `TraceFlameSpan` input keeps the response schema
out of the web package. Those paths move only
with their complete response parity characterized.

## Compatibility gate

The paged tree and row-version delta routes call the composed Trace service.
The current drawer's whole-tree anchor, shared-trace payload, full/detail
reads, resources, evaluations, annotations, redaction, enrichment, events,
links and blob data remain legacy. Migrate those only after a fixture proves
the complete payload, including null-versus-omitted fields, tenant isolation
and full/blob fallback.

The remaining transport gate is full-detail parity. Until that payload is
complete, the old route remains authoritative.
