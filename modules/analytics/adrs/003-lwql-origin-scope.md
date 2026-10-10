# ADR-003: A surface may leave trace origins out of a LangWatchQL statement

**Date:** 2026-10-09

**Status:** Proposed

## Context

Langy's own turns trace into the customer's project with `langwatch.origin = "langy"`
(dev/docs/adr/061-langy-trace-dual-export.md). The project home and the Explorer already leave
them out. Dashboards did not: every widget is a LangWatchQL statement, and only two catalogue
widgets filtered `Origin` by hand. A customer who uses Langy saw their volume, cost, latency and
error widgets move because of Langy.

Filtering in each widget does not hold: catalogue widgets, Langy-written widgets and
code widgets would each have to remember it, and a widget that forgets it is wrong in silence.
The LangWatchQL door so far runs a statement as written, plus the default `LIMIT`.

## Decision

A run may carry `excludeOrigins`, a list of trace origins. When the list is not empty, the
service replaces every catalogued view the statement reads with that view minus the rows of
those origins (`rules/langwatch-ql-query-scope.rules.ts`). The completeness report is scoped the
same way, so it counts the rows the widget counts.

- A view with an `Origin` column (`trace_metrics`, `evaluation_metrics`) filters on it.
- A view with a `TraceId` column filters out the traces `trace_metrics` gives those origins.
  When the statement follows the run's time window, that lookup reads only traces whose
  `OccurredAt` is at most one window length plus one day before the window start: the window
  length covers a comparison with the period before, and the day covers a trace first observed
  after its earliest span started. `OccurredAt` leads the `trace_metrics` sort key, so the bound
  prunes. With no window, or a statement with its own range, the lookup is unbounded.
- A view that can tell no origin (the per-minute rollups, Langy's own usage views) is untouched.

Only the tRPC `analytics.lwql.query` door accepts the field. `POST /api/v1/query` still runs
what it is sent. The Dashboards board composes the context it runs every query with in one place
(`BoardQueryContext`, read by `useBoardPeriod`) and sets `excludeOrigins` to `["langy"]` by
default. The built-in Source parameter planned for the board header shows that default and sets
the list; until it lands the default is not visible on the board.

## Rationale / Trade-offs

Scoping at the view reference keeps a widget's own `Origin` filter meaningful: a row that passes
the scope still meets the widget's predicate, so `Origin IN ('', 'application')` means what it
meant. A list, not a switch, leaves room for a board parameter that picks origins without a new
wire shape.

The per-minute rollups carry no origin, so a widget that reads them still counts Langy's spans.
Fixing that needs an origin dimension in the rollup, a storage change this decision does not make.

## Consequences

- Dashboards widgets leave Langy's turns out unless the board's query context says otherwise.
- The per-minute rollups (`trace_metrics_by_minute`, `model_usage_by_minute`) have no `Origin`
  column, so widgets that read them still count Langy's spans. Leaving Langy out there needs an
  origin dimension in the rollup, a storage change.
- A run with no time window, or a statement that does not follow the window, scans the tenant's
  whole `trace_metrics` history for the lookup. Every Dashboards widget sends a window, so this
  hits only widgets with their own fixed range, such as month to date.
- A row in the window whose trace was first observed more than the slack before the bound keeps
  its Langy rows. This is rare and accepted for the bounded scan.
- A widget that asks for `Origin = 'langy'` on a board reads no rows while the default holds.
- The scoped statement reads `trace_metrics` once more for views that only name a trace.
