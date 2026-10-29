# ADR-003: A LangWatchQL statement counts the trace origins it reads from a reserved parameter

**Date:** 2026-10-09 (rewritten 2026-10-29)

**Status:** Accepted

## Context

Langy's own turns trace into the customer's project with `langwatch.origin = "langy"`
(dev/docs/adr/061-langy-trace-dual-export.md). The project home and the Explorer already leave
them out. Dashboards did not: every widget is a LangWatchQL statement, and only two catalogue
widgets filtered `Origin` by hand. A customer who uses Langy saw their volume, cost, latency and
error widgets move because of Langy.

## History

The first version of this decision made the server rewrite the statement. A run carried
`sources`, and the service replaced every catalogued view the statement read with that view kept
to those origins (`rules/langwatch-ql-query-scope.rules.ts`), and scoped the completeness report
the same way. A board-wide `excludeOrigins` list came before that. The owner replaced both
(2026-10-28, 2026-10-29): the server no longer rewrites SQL, and a statement reads the origins
it counts as a parameter it declares. The rewriting service, its view-by-view rules and the
board column are gone.

## Decision

`{dashboard_context_sources:Array(String)}` is a reserved parameter, like the period names. The
server binds it on every run to the run's sources, one of `application`, `simulation`,
`evaluation`, `sample`, `coding_agent`, `ai_tool`, `gateway`, `workflow`, `playground`, `langy`
and `other` (`TRACE_SOURCES` in the analytics contract). A statement is kept to those origins
only where its SQL reads the parameter. A statement that does not read it counts every origin,
and the answer carries a `SOURCES_IGNORED` diagnostic when the run named its sources.

The views `trace_metrics` and `evaluation_metrics` carry a computed `Source` column,
`ifNull(nullIf(Origin, ''), 'application')`, with any origin outside the list read as `other`.
So an unstamped trace is `application`'s and never NULL. The column is computed in the view; no
ClickHouse migration is made. A statement keeps its rows with
`WHERE Source IN {dashboard_context_sources:Array(String)}`. A view with a `TraceId` column
reaches the origin through `(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics
WHERE Source IN {dashboard_context_sources:Array(String)})`, keyed by tenant so another
project's trace never decides.

The list is an enum checked at the door, and a caller cannot supply, assign or alias the
reserved name in its own parameters. An empty list matches no row. Picking every source keeps
every row.

Each Dashboards widget query stores its own `sources` in its definition, set in the widget editor
and through the widget API and CLI (`--sources`). A query that stores none runs with
`DEFAULT_WIDGET_SOURCES`, `["application"]`, on the server. A run that is no widget's reads the
sources it names, or the default `application` for the REST door. Each stock widget declares the
list its SQL reads. The query door echoes the bound value in `params`
(`specs/lwql/query-params.feature`).

## Rationale / Trade-offs

The SQL is the single account of what a widget counts: what you read is what runs, and a widget's
own `Origin` filter keeps its meaning. Sources on each query, not a board-wide list, let one
widget count Langy's turns while its neighbours do not. An opt-in parameter costs every widget an
edit, which is why the stock widgets declare theirs and a diagnostic tells a custom query that
ignores it.

## Consequences

- Dashboards widgets count application traces unless a query's sources say otherwise.
- The per-minute rollups (`trace_metrics_by_minute`, `model_usage_by_minute`) and Langy's own
  usage views have no `Origin` column, so a widget that reads them counts every origin and says
  sources do not apply. Reading the parameter there needs an origin dimension in the rollup, a
  storage change.
- A widget whose SQL never reads the parameter ignores its stored list. The editor disables the
  sources row with the reason.
- A widget that asks for `Origin = 'langy'` reads no rows until its sources name `langy`.
- A run that is no widget's may send `projects` as the string `"all"` (owner, 2026-10-29: "1 sure"):
  every project the key or member holds `analytics:view` on, in its own organization, echoed in id
  order in `params.dashboard_context_projects`. None is `project_not_found` (404); more than the
  cap (10,000 for a key, 100 for a member) is a 422. A key that reaches several projects and names
  none is still refused with `projects_required`, which names `"all"` as the way out. A widget
  stores explicit ids and refuses `"all"`, so a stored definition never changes meaning when access
  changes.
