# Trace

Trace owns portable read contracts and the first server implementation: the
viewer-safe, cursor-paged span tree. `trace_summaries` supplies trace lookup
and summary data; `trace_analytics` remains the lighter analytical source and
`trace_analytics_rollup` the time-series source.

## Journey

1. A transport authenticates the project and resolves viewer capabilities.
2. `TraceService` reads tenant-scoped projected span summaries.
3. The service calculates or withholds cost, validates the portable DTO, and
   returns a keyset cursor.

Full trace detail is still legacy. It couples the full `Trace`/`Span` models,
visibility protections, annotations, evaluations, coding-agent enrichment,
event/link mapping, offloaded event-log resolution, and the IO extractor. The
next move must compose all of those once behind the same `TraceService`; it
must not point a route at a partial replacement.

The duplicate legacy `server/traces` full-span ClickHouse repository has been
removed. The app-layer span-storage repository is now the single full-span
reader until that complete migration.

See [ADR-001](./adrs/001-trace-read-boundary.md) and the
[read contract](./specs/trace-read-service.feature).
