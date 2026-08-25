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

This slice does not move headers, full/detail reads, list/search, projections,
eventing, overlays, evaluations, enrichment, resources, logs, or signals.
Those paths move only with their complete response parity characterized.

## Compatibility gate

The adapter is not wired to a REST or tRPC route. The current drawer combines
resource, evaluation, annotation, redaction, enrichment, event/link and blob
data. Migrate only after a fixture proves the complete payload, including
null-versus-omitted fields, cursor/timestamp semantics, tenant isolation and
full/blob fallback.

The repository keeps the calculator inputs private and the service delegates
missing positive stored cost to the full Model Provider service. That service
owns the one canonical custom, SDK, static, cache, audio and guardrail pricing
cascade. The remaining transport gate is therefore full-detail parity, not a
second cost implementation. Until that payload is complete, the old route
remains authoritative.
