-- The reserved LangWatchQL period placeholders were renamed from
-- `{dashboard_context_period_start:DateTime}`,
-- `{dashboard_context_period_end:DateTime}` and
-- `{dashboard_context_granularity_seconds:UInt32}` to `{period_start:...}`,
-- `{period_end:...}` and `{period_granularity_seconds:...}`
-- (server/analytics/lwql/timeWindow.ts). Only the new names are bound by the
-- surface showing the chart; a statement still written with the old ones
-- declares three ordinary parameters nobody supplies, and every run refuses
-- with `lwql_parameter_missing`.
--
-- Rewrites the placeholders inside every stored chart definition, once, so
-- charts written before the rename keep following the dashboard's period.
-- The match includes the opening brace and the trailing colon so only a
-- placeholder is rewritten, never a column or alias that happens to share
-- the prefix.
--
-- IRREVERSIBLE by design: the application no longer binds the old names.

UPDATE "CustomGraph"
SET "graph" = replace(replace(replace("graph"::text,
    '{dashboard_context_period_start:', '{period_start:'),
    '{dashboard_context_period_end:', '{period_end:'),
    '{dashboard_context_granularity_seconds:', '{period_granularity_seconds:')::jsonb
WHERE "graph"::text LIKE '%{dashboard_context_%';
