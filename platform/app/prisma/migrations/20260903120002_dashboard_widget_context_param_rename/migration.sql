-- Rename dashboard-widget reserved parameters to their namespaced form.
--
-- See dev/docs/adr/129-dashboard-context-vs-params.md: widget author code
-- (srcdocHtml / TSX) and the SQL strings inside a "dashboard_srcdoc" widget's
-- "graph" jsonb used the reserved names `period_start`, `period_end`,
-- `period_granularity_seconds`, `LW.params.timeWindow`,
-- `LW.params.granularitySeconds` and `LW.onParamsChange(...)`. Those names
-- are now namespaced under `dashboard_context_*` / `LW.dashboardContext.*` /
-- `LW.onDashboardContextChange(...)` so they cannot collide with a widget's
-- own params. This migration rewrites already-stored widgets to match.
--
-- replace() runs on graph::text, i.e. the JSON-escaped form of the jsonb
-- value. Every token below is plain identifier/dotted-path text with no
-- quote or backslash characters, so escaping is unaffected and the result
-- always casts back to valid jsonb.
--
-- Only rows containing at least one old token are touched, so this is safe
-- to run more than once (idempotent) and a no-op for widgets already on the
-- new names.

UPDATE "CustomGraph" SET graph = replace(replace(replace(replace(replace(replace(graph::text,
  '{period_start:', '{dashboard_context_period_start:'),
  '{period_end:', '{dashboard_context_period_end:'),
  '{period_granularity_seconds:', '{dashboard_context_granularity_seconds:'),
  'LW.params.timeWindow', 'LW.dashboardContext.timeWindow'),
  'LW.params.granularitySeconds', 'LW.dashboardContext.granularitySeconds'),
  'LW.onParamsChange(', 'LW.onDashboardContextChange(')::jsonb
WHERE kind = 'dashboard_srcdoc' AND (graph::text LIKE '%{period_start:%' OR graph::text LIKE '%{period_end:%' OR graph::text LIKE '%{period_granularity_seconds:%' OR graph::text LIKE '%LW.params.timeWindow%' OR graph::text LIKE '%LW.params.granularitySeconds%' OR graph::text LIKE '%LW.onParamsChange(%');
