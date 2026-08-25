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

## Browser display toolkit

`web` owns browser-safe trace presentation components and helpers: ANSI and
preview formatting, prompt/SDK/origin labels, time and URL display state, the
input/output and media-strip views, and the billed-versus-bundled cost split.
It also owns the loaded-trace find index, match cycling, browser highlighting,
and find-bar presentation, plus the controlled flame-graph presentation and
viewport/tree behaviour. The app keeps thin compatibility adapters while
page composition, authentication, data fetching, and every trace transport
response remain in the app.

See [ADR-001](./adrs/001-trace-read-boundary.md) and the
[read contract](./specs/trace-read-service.feature).
