# ADR-001: Trace owns the viewer-safe span-tree read boundary

**Status:** Accepted

**Behavioural contract:** [Trace read service](../specs/trace-read-service.feature)

## Decision

Trace owns the first read service for the existing
`tracesV2.spanTreePaginated` response shape. The portable contract uses Zod 4
schemas and preserves every field and nullish optionality in that endpoint.
Every read carries the tenant/project id to persistence. A missing trace keeps
the current endpoint behaviour and returns an empty page with a null cursor.

The server keeps one private Trace repository. Its ClickHouse implementation
is composed by the server adapter and never crosses the package export
boundary. Cost redaction is applied after persistence reads and before DTO
validation.

This slice deliberately does not move headers, span details, full/blob reads,
list/search, projections, eventing, edit overlays, evaluations, transcript
enrichment, resource metadata, logs, signals, or other trace viewer paths.
Those paths have additional cross-feature dependencies and will move only when
their complete response parity is characterized.

## Compatibility gate

The adapter is not yet wired to an existing REST or tRPC route. The current
drawer response is assembled by several legacy loaders and includes additional
resource, evaluation, annotation, redaction, and enrichment fields. A route
may migrate only after a characterization fixture proves the complete existing
payload, including null-versus-omitted fields, cursor and timestamp semantics,
tenant isolation, event/link data, and full/blob resolution.

The package deliberately selects every input to the live cost mapper, but does
not yet own the canonical `computeSpanCost` dependency graph. Its live fallback
includes custom rates, an SDK total, static model prices, cache TTL, audio, and
guardrail pricing; returning the raw stored cost alone would change valid
responses. That exact calculator must move as one canonical dependency (not a
second implementation) before this service can be wired. Until then the old
route remains authoritative and this package is an internal composition
candidate, not a transport replacement.
