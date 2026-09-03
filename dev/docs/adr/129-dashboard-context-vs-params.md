# ADR-129: Dashboard Context vs. Params

**Date:** 2026-09-03

**Status:** Accepted

## Context

A dashboard widget's SQL and code can reference two kinds of named value: something the host page already knows (the visible time window, its bucket granularity) and something the widget author declares itself (a filter, a threshold, a label). These two were previously blurred under one name list — `period_start`, `period_end`, `period_granularity_seconds` — reserved by exact-name lookup against `RESERVED_PARAMETERS`. A widget author had to memorize the exact reserved names to avoid collisions, and nothing in the naming told a reader which values were host-supplied versus author-declared.

## Decision

Two namespaces, kept explicitly separate by name:

- **Dashboard context** — host-supplied, read-only. In SQL: `{dashboard_context_period_start:DateTime}`, `{dashboard_context_period_end:DateTime}`, `{dashboard_context_granularity_seconds:UInt32}`. In widget code: `LW.dashboardContext` / `LW.useDashboardContext()`.
- **Params** — author-declared, with defaults, user-overridable. In SQL: `{name:Type}`. In widget code: `LW.params` / `LW.useParams()`.

The reservation rule changes from an exact-name list to a **prefix**: any author-declared parameter name starting with `dashboard_context_` is rejected (error code `dashboard_widget_query_reserved_param`, unchanged; message now names the prefix). This closes the namespace instead of a fixed set of names, so a future host-supplied value (e.g. a timezone) is reserved by construction, not by remembering to add it to a list.

A widget wanting its own time window declares a normal param, optionally seeded from dashboard context (e.g. a default derived from `LW.dashboardContext`). There is no merge or precedence rule between the two namespaces — they never collide by definition, because params may never start with the reserved prefix.

## Consequences

- The 31 existing widgets that reference `period_start` / `period_end` / `period_granularity_seconds` need a one-off rewrite to the `dashboard_context_*` names.
- All exported TypeScript identifiers (`RESERVED_PARAMETERS`, `LWQL_PERIOD_START_PARAMETER`, `LWQL_PERIOD_END_PARAMETER`, `LWQL_PERIOD_GRANULARITY_PARAMETER`) are unchanged — only their string values changed — so consumers importing these constants are unaffected by the rename itself.
- New export `DASHBOARD_CONTEXT_PARAMETER_PREFIX = "dashboard_context_"` in `src/server/analytics/dashboardWidgetDefinition.ts` is the single source of truth for the reserved namespace.

## References

- `platform/app/src/server/analytics/dashboardWidgetDefinition.ts`
- `platform/app/src/server/analytics/lwql/timeWindow.ts`
