# ADR-002: Full trace detail moves behind TraceService whole, not in parts

**Status:** Accepted (moved from the module README, 2026-10-06)

## Context

The paged span tree and the row-version delta are served by `TraceService`. Full
trace detail is not: it couples the full `Trace` and `Span` models, visibility
protections, annotations, evaluations, coding-agent enrichment, event and link
mapping, offloaded event-log resolution and the IO extractor.

## Decision

Full trace detail moves behind the same `TraceService` in one step that composes
all of those once. No route is pointed at a partial replacement.

Until then the span-storage repository
(`process/src/repositories/span-storage.repository.ts`) stays the single
full-span and whole-tree-anchor reader. It no longer serves the paged tree or the
row-version delta.

## Consequences

A reader that needs full trace detail goes through the span-storage repository
inside trace, never a second copy of the full-span read.
