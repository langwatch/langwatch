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

`TraceProcessingServerInstaller` is the package-owned registration boundary for
that pipeline. It registers `assignTopic`, deferred-origin resolution, and the
Dataset-normalize worker job with their existing routing, delay, deduplication,
and grouping semantics. The application composes the complete Trace pipeline
definition and effect adapters through named ports; it does not register a
second Trace job graph.

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

The worker may mount this installer before Topic so Topic receives the canonical
Trace assignment port. Shared Eventing consumption remains disabled until every
active shared-queue pipeline is mounted; a mounted Trace tranche is not itself
authorization to consume unknown jobs.

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

Internal full-record and chronological thread reads use the package-owned
ClickHouse repository over `trace_summaries` and `stored_spans`. The repository
recalls claim-check payloads only through a process-composed, tenant-scoped
payload port; a missing payload keeps the stored preview. Legacy app detail
services remain deliberate transport/residual composition until their callers
move to this internal contract, including caller-specific protections,
annotations, Evaluation enrichment, and edit overlays.

`TraceService.getFullRecord` and `getFullThread` are internal all-visible
process reads: a caller supplies only a tenant and trace/thread identity, never
a viewer. They apply the package's explicit internal all-visible policy after
normalized span assembly. The same package rule also accepts a viewer-derived
policy for the later public cutover, but no current public transport invokes
these methods. Viewer-specific reads therefore remain in
`platform/app/src/server/traces/trace.service.ts` and
`platform/app/src/server/traces/clickhouse-trace.service.ts`; their protected
detail, export and thread callers still require annotations, edit overlays and
transport-specific authorization. Their characterization suites remain under
`platform/app/src/server/traces/__tests__/trace-service-4888-full-flag.unit.test.ts`,
`trace-service-blob-resolution.unit.test.ts`, and
`clickhouse-trace.service-4991-bulk.unit.test.ts`.

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

### Full-read characterization status

The package's `TraceFullRecord` remains an internal all-visible capture. It is
not a substitute for the legacy viewer/export `Trace` response. The following
matrix is a current compatibility gate for that later cut; it is deliberately
not a future design decision.

| Behaviour                                                           | Current authoritative owner                   | Package full reader status                                                             |
| ------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tenant/private ClickHouse resolution                                | App `ClickHouseTraceService`                  | Package has a tenant-scoped port, but no production caller                             |
| Storage anchor versus earliest span start                           | App summary mapper and anchored-window reader | Reads a supplied anchor as authoritative; stale-anchor retry is not characterized      |
| Topic and subtopic identity                                         | App summary mapper                            | Not represented in `TraceFullRecord` metadata                                          |
| Reserved token and log metrics                                      | App summary mapper                            | Token/log aliases are not parity-proven in the full reader                             |
| `trace_summaries`, `trace_analytics`, and rollups                   | Separate App/package projection owners        | Must remain separate; no substitution is permitted                                     |
| Blob recall and preview fallback                                    | App blob resolver plus I/O recomputation      | Internal payload-port recall exists, but viewer/export opt-in and bulk behavior differ |
| Protections and edit overlays                                       | App `TraceService`                            | Package only applies its internal all-visible policy                                   |
| Evaluations, annotations, coding-agent enrichment, links and events | App full-detail composition                   | Not complete in the package reader                                                     |

The legacy mapper characterization fixture asserts the earliest-start baseline,
topic identities, and reserved metrics. Existing blob, protection, overlay and
bulk-read suites remain required evidence for the remaining rows. No legacy
full-read production code may be deleted while any row differs.

## Browser boundary

The web package owns reusable, transport-neutral presentation and loaded-row
behaviour. The app supplies routing, data hooks and small named render ports for
media, terminal and anchored-comment UI. Browser code does not authorize,
compose services or reshape Trace responses.

## Public surfaces and transports

The contract publishes the read, ingress and processing vocabulary: trace and
span values, the query language, the commands and events the pipeline exchanges,
the ingestion age limit and the errors. The server package publishes the
ClickHouse-backed services and the processing installer. The web package
publishes reusable, transport-neutral presentation. Trace mounts no route: the
`/api/traces` REST application, the trace export application and the `tracesV2`
tRPC router are host transports, and the standalone API application takes the
topic assignment port from the contract rather than a second implementation.

## Dependencies

The contract depends on the shared handled-error package, a query parser, a
pattern-matching helper and Zod. The server depends on that contract, on the
Model Provider contract for cost lookup, on the Prompt contract for the metadata
carried on spans, on the Dataset and Coding Agent contracts for the effects it
hands off, on the Eventing package for its commands, projections and stores, on
the OpenTelemetry interfaces and the OTLP transformer for ingress traversal, on
the shared identifier generator, on the shared observability logger, and on the
LangWatch tracer for its own instrumentation. It depends on no application
module.

## Persistence

Every durable read and write is a ClickHouse call through repositories private
to the server package, carrying a tenant identifier. `trace_summaries`,
`stored_spans`, `trace_analytics` and the timeseries rollup are four distinct
projections that are never substituted for one another. "Persistence and query
parity" above states the rules that govern them, including anchor handling,
claim-check payload recall and cost redaction ordering.

## Runtime and registration

Composition roots build one trace service, ingestion service, canonicalisation
service and processing graph per process, injecting ClickHouse resolution,
deduplication, spool and blob access, privacy preparation, tokenization,
pricing, media extraction and projection storage through named ports. The
package-owned processing installer is the only registration boundary: the
application's pipeline registry mounts it, and the definitions it registers are
the same in every process while only worker-capable roles consume the resulting
jobs. Cross-feature effects subscribe to that graph rather than registering a
second one.

## Environment and configuration

Trace packages read no environment value. Retention defaults, read caps,
ClickHouse resolution and every port arrive at composition. The one shared
setting the feature reads is the identifier environment prefix, which the
process sets once at boot on the shared identifier generator; Trace reads that
configured value, never an environment variable.

## Errors

A missing trace throws a concrete not-found error that each transport maps to
its own successful-empty or not-found response, because those responses already
differ per route and unifying them would be a behaviour change. A query the
parser rejects throws `filter_parse_error`, and a query naming an unknown field
throws `filter_field_unknown`; both are handled errors carrying the offending
detail, so a caller can correct the query rather than retry it. Persistence
failures stay unhandled and keep their existing transport mapping.

## Contracts and validation

Zod 4 schemas define the read responses, the ingress payloads, the commands and
events, and the projection data, preserving the existing transport fields and
their nullability. Cost redaction happens after persistence and before response
validation, so a redacted value is still a valid response rather than a hole in
one. ClickHouse row shapes stay inside the server package.

## Consequences

Displaced app command, projection, schema and store modules are deleted once
their package coverage is canonical. Remaining app modules are explicit
transport, composition or external-effect adapters; they are not a second
processing stack.
