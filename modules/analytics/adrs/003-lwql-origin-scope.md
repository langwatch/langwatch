# ADR-003: A dashboard query names the trace origins a LangWatchQL statement counts

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

A run may carry `sources`, the trace origins it counts, one of `application`, `simulation`,
`evaluation`, `sample`, `coding_agent`, `ai_tool`, `gateway`, `workflow`, `playground`, `langy`
and `other`
(`TRACE_SOURCES` in the analytics contract). The service replaces every catalogued view the
statement reads with that view kept to those origins (`rules/langwatch-ql-query-scope.rules.ts`).
The completeness report is scoped the same way, so it counts the rows the widget counts.

Every comparison reads the origin through one expression, `ifNull(nullIf(Origin, ''),
'application')`, so an unstamped trace (empty or NULL) is `application`'s and never NULL. A set
without `other` keeps `origin IN (picked)`; a set with `other` drops the listed origins left out,
`origin NOT IN (unpicked)`, so every unlisted origin stays. All nine keep every row: the statement
runs as written. An empty set reads no row of any view. The list is an enum checked at the door,
and only the fixed names are ever written into a statement.

- A view with an `Origin` column (`trace_metrics`, `evaluation_metrics`) filters on it.
- A view with a `TraceId` column filters out the traces `trace_metrics` gives an origin the set
  does not keep. When the statement follows the run's time window, that lookup reads only traces
  whose `OccurredAt` is at most one window length plus one day before the window start: the
  window length covers a comparison with the period before, and the day covers a trace first
  observed after its earliest span started. `OccurredAt` leads the `trace_metrics` sort key, so
  the bound prunes. With no window, or a statement with its own range, the lookup is unbounded.
- A view that can tell no origin (the per-minute rollups, Langy's own usage views) is untouched.

Only the tRPC `analytics.lwql.query` door accepts the field. `POST /api/v1/query` still runs
what it is sent. Each Dashboards widget query stores its own `sources` in its definition, set in
the widget editor as the query's first parameter and through the widget API and CLI
(`--sources`). A query that stores none is sent with `sources: null`, and the scope rule
reads that as `DEFAULT_WIDGET_SOURCES`, `["application"]`, on the server, in every project; a
run that is no widget's sends no `sources` and reads every origin, as before; a new widget's query is stored with it (owner, 2026-10-28). A From LangWatch
board's catalogue widgets name every source but `langy`. This replaces the board-wide
`excludeOrigins` list, its "Langy traces" header control and the board column behind them
(owner, 2026-10-28).

## Rationale / Trade-offs

Scoping at the view reference keeps a widget's own `Origin` filter meaningful: a row that passes
the scope still meets the widget's predicate, so `Origin IN ('', 'application')` means what it
meant. Sources on each query, not a board-wide list, let one widget count Langy's turns while
its neighbours do not.

The per-minute rollups carry no origin, so a widget that reads them still counts Langy's spans.
Fixing that needs an origin dimension in the rollup, a storage change this decision does not make.

## Consequences

- Dashboards widgets count application traces unless a query's sources say otherwise.
- The per-minute rollups (`trace_metrics_by_minute`, `model_usage_by_minute`) have no `Origin`
  column, so widgets that read them still count Langy's spans. Leaving Langy out there needs an
  origin dimension in the rollup, a storage change.
- A run with no time window, or a statement that does not follow the window, scans the tenant's
  whole `trace_metrics` history for the lookup. Every Dashboards widget sends a window, so this
  hits only widgets with their own fixed range, such as month to date.
- A row in the window whose trace was first observed more than the slack before the bound keeps
  its Langy rows. This is rare and accepted for the bounded scan.
- A widget that asks for `Origin = 'langy'` reads no rows until its query's sources name `langy`.
- The scoped statement reads `trace_metrics` once more for views that only name a trace.
