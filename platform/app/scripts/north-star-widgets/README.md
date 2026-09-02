# North-star dashboard widgets

Ten dashboard widgets, one per `@langwatch/charts` primitive,
showing the intended "north-star" shape of a dashboard widget: a query
scoped only to `{period_start:DateTime}` / `{period_end:DateTime}`, a
component from the shared chart library, and the three guard-clause states
(error, loading, empty) every widget should degrade through gracefully.

Every query below declares no explicit parameters — each uses only the
reserved `{period_start:DateTime}` / `{period_end:DateTime}` bounds, which the
executor fills from the page's own time window automatically (see
`platform/app/src/features/custom-chart-playground/presets.ts`).

| # | file | primitive | north-star source | data source | notes |
|---|---|---|---|---|---|
| 1 | `north-star-metric-stat.json` | MetricStat | daily trace count | `trace_metrics` | `uniqExact(TraceId)` per day, `TotalDurationMs > 0` phantom-row filter; sparkline reuses the same daily series. |
| 2 | `north-star-sparkline.json` | Sparkline | daily cost | `trace_metrics` | `sum(TotalCost)` per day, same phantom-row filter. |
| 3 | `north-star-area-timeseries.json` | AreaTimeseries | daily prompt/completion tokens | `trace_metrics` | Stacked `sum(PromptTokens)` / `sum(CompletionTokens)`. |
| 4 | `north-star-stacked-bars.json` | StackedBars | daily ok vs error trace counts | `traces` | `ContainsErrorStatus` (Bool, confirmed on `traces`) drives `uniqExactIf`; no `TotalDurationMs` gate needed — that column lives on `trace_metrics`, not `traces`. |
| 5 | `north-star-grouped-bars.json` | GroupedBars | top 8 models by token volume | `trace_metrics` | `Models` is `Array(String)`, unnested via `arrayJoin` in a subquery, then grouped. |
| 6 | `north-star-projection-bars.json` | ProjectionBars | daily cost with a projected last bucket | `trace_metrics` | Same query as widget 2; `projectionFrom` and `budget` (~2x median daily cost) computed client-side — see the in-code comment on why the last bucket is treated as a projection. |
| 7 | `north-star-donut.json` | Donut | top 6 models by trace count | `trace_metrics` | Same `arrayJoin(Models)` shape as widget 5, `uniqExact(TraceId)`. |
| 8 | `north-star-leaderboard.json` | Leaderboard | top 10 users by trace count | `trace_metrics` | **Adjusted from sketch**: `UserId` does not exist on `traces` (confirmed against `lwqlViews.ts`) — it is a `trace_metrics`-only column. Query and phantom-row filter moved to `trace_metrics`. |
| 9 | `north-star-heatmap.json` | Heatmap | trace count by hour × day-of-week | `traces` | `toHour(OccurredAt)` / `toDayOfWeek(OccurredAt)` buckets, `uniqExact(TraceId)`. |
| 10 | `north-star-lwql-chart.json` | LwqlChart | daily trace count, no `kind` prop | `trace_metrics` | Same query shape as widget 1; left for `LwqlChart`'s own shape inference (2-column time series → area chart). |

## 13 primitives, coverage

`chartsLib/index.ts` exports 10 components (`MetricStat`, `Sparkline`,
`AreaTimeseries`, `StackedBars`, `GroupedBars`, `ProjectionBars`, `Donut`,
`Leaderboard`, `Heatmap`, `LwqlChart`) plus an internal `Table` used only as
`LwqlChart`'s fallback kind — this golden set ships one widget per exported
component, ten widgets total.

Two primitives named in earlier planning are intentionally cut from v1:
**Treemap** (≈ `Donut` — same name/value shape, different layout) and
**ContributionCalendar** (≈ `Heatmap` — same hour/day bucket shape, calendar
layout instead of grid). Neither is exported by `chartsLib/index.ts` today.
`ChartCard` is not a data widget at all — it's the playground's own card
chrome/host that wraps every widget, not something a widget author renders.

## Needs data unavailable in this env

Two ground-truth columns exist in the catalog but are empty in this
environment, so no widget here queries them. Starter queries, ready to drop
into a new widget once seeded data exists:

**Satisfaction — MetricStat** (`traces.SatisfactionScore`, confirmed
`Nullable(Float64)` at `lwqlViews.ts` line ~233):

```sql
SELECT avg(SatisfactionScore) AS score
FROM traces
WHERE SatisfactionScore IS NOT NULL
  AND OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}
```

**Evaluation pass rate — Donut** (`evaluation_metrics.Passed`, confirmed
`Nullable(Bool)` at `lwqlViews.ts` line ~1417 — column name matches the
brief's sketch, no adjustment needed):

```sql
SELECT if(Passed, 'pass', 'fail') AS outcome, count() AS n
FROM evaluation_metrics
WHERE Passed IS NOT NULL
  AND OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}
GROUP BY outcome
```

## Files

- `north-star-*.json` — the 10 widget definitions (`{ name, code, queries }`),
  one file per `@langwatch/charts` primitive.
- `seed.mjs` — creates all 10 widgets in a project via the REST API
  (`POST /api/v1/projects/{projectId}/analytics/dashboard-widgets`, see
  `platform/app/src/app/api/analytics-sql/[[...route]]/app.dashboard-widgets.v1.ts`).
  Configured via `LW_ENDPOINT`, `LW_API_KEY`, `PROJECT_ID` env vars. Lists
  existing widgets first and skips any whose name already matches, so
  re-running is idempotent-ish (it will not update a widget edited since the
  last seed — see the script's own doc comment).

## Ground truth cited

- `platform/app/src/features/custom-chart-playground/bridge/chartsLib/index.ts` — the 10 component prop shapes.
- `platform/app/src/server/analytics/lwql/catalog/lwqlViews.ts` — `traces` (~89-322), `trace_metrics` (~819-1053), `evaluation_metrics` (~1349-1531).
- `platform/app/src/features/custom-chart-playground/presets.ts` — reserved `{period_start}` / `{period_end}` parameter contract.
- `skills/recipes/dashboard-widgets/SKILL.mdx` — worked widget example and hook contract.
- `platform/app/scripts/legacy-parity-widgets/` — sibling golden set (per-legacy-chart, rather than per-primitive) this set mirrors in structure.
