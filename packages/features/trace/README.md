# Trace

Trace owns portable read contracts and the live server implementation for the
viewer-safe, cursor-paged span tree and row-version delta. Both read
`stored_spans`; `trace_summaries` supplies other trace lookup/summary data,
`trace_analytics` remains the lighter analytical source, and
`trace_analytics_rollup` the time-series source.

Raw spans and logs pass through one deterministic canonicalisation service
before the pipeline derives four deliberately different projection shapes:
trace summaries, trace analytics, stored spans and timeseries rollups. The app
keeps process composition and transport adapters; it does not implement a
second canonicalisation path.

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

The app-layer span-storage repository remains the single full-span and
whole-tree-anchor reader until that complete migration. It no longer owns the
paged tree or row-version delta queries.

## Browser display toolkit

`web` owns browser-safe trace presentation components and helpers: ANSI and
preview formatting, prompt/SDK/origin labels, time and URL display state, the
input/output and media-strip views, and the billed-versus-bundled cost split.
It also owns the loaded-trace find index, match cycling, browser highlighting,
and find-bar presentation, plus the controlled flame-graph presentation and
viewport/tree behaviour. The app keeps thin compatibility adapters while
page composition, authentication, data fetching, and every trace transport
response remain in the app.

The browser package also owns the reusable transcript parser and presentation
stack: turn grouping, role visuals, reasoning/tool cards, and virtualization.
App-owned media, terminal, and anchored-comment widgets enter through named
render ports; the transcript never fetches or authorizes.

See [ADR-001](./adrs/001-trace-read-boundary.md) and the
[read contract](./specs/trace-read-service.feature).
