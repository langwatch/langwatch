# ADR-003: A LangWatchQL statement counts the trace origins it reads from a reserved parameter

**Date:** 2026-10-09 (rewritten 2026-10-29, trace lookup and its bound revised 2026-11-06)

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
reaches the origin through `trace_metrics`, keyed by tenant so another project's trace never
decides. The stock widgets write that lookup in one of two fixed forms, by the view they read.

`traces` and `spans` hold two sets, each with the switch in its own WHERE. Writing `S` for
`{dashboard_context_sources:Array(String)}`, `k` for `(TenantId, TraceId)` and `<bound>` for the
lookup's time bound:

```sql
(has(S, 'application')
  OR k IN (SELECT TenantId, TraceId FROM trace_metrics
           WHERE NOT has(S, 'application') AND Source IN S AND <bound>))
AND k NOT IN (SELECT TenantId, TraceId FROM trace_metrics
              WHERE has(S, 'application') AND Source NOT IN S AND <bound>)
```

| List                       | Excluded set (`NOT IN`) | Included set (`IN`) | Keeps                                            |
| -------------------------- | ----------------------- | ------------------- | ------------------------------------------------ |
| `['application']`          | traces of other sources | empty               | application traces and traces with no row        |
| `['application', 'langy']` | traces of neither       | empty               | those two sources' traces and traces with no row |
| `['langy']`                | empty                   | Langy's traces      | Langy's traces only                              |
| `[]`                       | empty                   | empty               | nothing                                          |

While the list holds `application`, the widget leaves out the traces of the other sources. On a
large project those are the small set; the chosen ones took 30-day trace-list widgets over the query
memory limit. A trace with no `trace_metrics` row is an unstamped trace, which is `application`'s,
so it counts. Until its row is written, a brand-new trace of another source also has no row, so it
counts too while the list holds `application`. While the list leaves `application` out, the widget
keeps the traces of the list, and a trace with no row drops. Measured on prod, 30 days, one large
project, a limit of about 1 GB: under `['application']` the excluded set used 571 MB where the
included set failed at the limit; under `['langy']` the excluded set used 937 MB where the included
set used 40 MB. Those figures are for the old single forms; the combined form is not yet measured
on prod.

Why the switch sits inside each subquery: the list is bound at run time, so the SQL cannot choose
its form. An outer `if`, `AND` or `OR` round two subqueries may not stop either set being built: a
local check on ClickHouse 25.10.2 with a 150 MB cap, run by hand and not in CI, read nothing from a
30-million-row subquery with the guard and hit `MEMORY_LIMIT_EXCEEDED` without it. Each subquery's
WHERE starts with a condition on the bound list alone, a constant, so the side that does not apply
reads to no row and its set is empty. Only one set ever holds rows. No `notEmpty` guard is needed:
an empty list fills neither set, so `has` is false, the `IN` is false, and no row is kept.

The bound reaches as far back as the query scans, so every trace a query scans counts by its own
source. It is one window back plus a day, which covers a query that compares with the previous
period. A query that scans from `subtractDays({dashboard_context_period_start:DateTime}, N)` with a
literal `N` gets `least(<one window back plus a day>, subtractDays(<period start>, N))`, the largest
`N` when it has several; one day or less adds nothing. The changes widgets (`ck-trend`,
`ext-cost-per-doc`) scan 90 days, so a prompt used earlier only by a Langy trace reads as new
under `['application']` and as not new under `['langy']`. A trace older than the bound is outside
the query's scan too. The lookup alone would count it while the list holds `application` and drop
it while it does not, as it drops an evaluation.

Consequences: a trace with rows of two sources (its anchor moved) drops under either source alone
while the list holds `application`, and counts under either one while it does not. Each stock query
over `traces` or `spans` returns the rows of the single lookup, apart from those traces and the
traces with no row (`lwql-sources-row-equality.integration.test.ts`).

`evaluations` and `annotations` keep `(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM
trace_metrics WHERE Source IN {dashboard_context_sources:Array(String)})`. Their trace id can be
NULL, their rows often sit on old traces, which the complement would count whatever the source,
and `annotations` reads PostgreSQL, a path the complement has not been measured on.

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
  order in `params.dashboard_context_projects`. A member who reads none gets `project_not_found`
  (404); a key that reads none gets `projects_unreadable` (422), as it does when it names nothing.
  More than the cap (10,000 for a key, 100 for a member) is a 422. A key that reaches several
  projects and names none is refused with `projects_required`, which names `"all"` as the way out.
  `"all"` inside a list is refused: it stands alone. A widget
  stores explicit ids and refuses `"all"`, so a stored definition never changes meaning when access
  changes.
