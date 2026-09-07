# Legacy analytics parity widgets

Eight custom-chart-playground widgets that reproduce the legacy `/analytics`
dashboard charts (metrics, users, evaluations pages) as LangWatchQL-backed
widgets, so the playground can replace those pages chart-for-chart.

Every query below declares no explicit parameters — each uses only the
reserved `{period_start:DateTime}` / `{period_end:DateTime}` bounds, which the
executor fills from the page's own time window automatically (see
`platform/app/src/features/custom-chart-playground/presets.ts`).

| # | Widget file | Legacy chart it mirrors | Semantic deltas / caveats |
|---|---|---|---|
| 1 | `legacy-trace-count-over-time.json` | `metadata.trace_id` metric, `platform/app/src/server/analytics/registry.ts:36` ("Traces", `cardinality` aggregation) | Uses `trace_metrics` with `uniqExact(TraceId)` per day, matching the catalog's own guidance at `platform/app/src/server/analytics/lwql/catalog/lwqlViews.ts:822` ("Count traces with uniqExact(TraceId)") rather than plain `count()`, because a pre-freeze row can appear under two `OccurredAt` values. |
| 2 | `legacy-latency-percentiles.json` | `performance.completion_time` metric with percentile aggregations, `platform/app/src/server/analytics/registry.ts:79-84` | `quantile(p)(TotalDurationMs)` from `trace_metrics` for p50/p90/p99 in one query, where legacy renders one percentile per selected aggregation. `quantile()` is approximate (t-digest) in ClickHouse; legacy's percentile aggregation is computed server-side over the same rollup family, so this is an approximation of an approximation, not a new source of error. |
| 3 | `legacy-total-cost-over-time.json` | `performance.total_cost` metric, `platform/app/src/server/analytics/registry.ts:89-95` | `sum(TotalCost)` from `trace_metrics`, gated by the `costs` column gate (`lwqlViews.ts:943`). Cost visibility is enforced server-side by lwql for the caller's permissions — the widget does not check or hide anything itself, matching the brief. |
| 4 | `legacy-tokens-over-time.json` | `performance.prompt_tokens` / `performance.completion_tokens` metrics, `platform/app/src/server/analytics/registry.ts:115-127` | Stacked area of `sum(PromptTokens)` and `sum(CompletionTokens)` from `trace_metrics` in one widget, where legacy renders each as a separate selectable metric. Cache/reasoning token metrics exist on the same table (`CacheReadTokens`, `CacheWriteTokens`, `ReasoningTokens`) but are out of scope for the golden set. |
| 5 | `legacy-evaluation-pass-rate.json` | Evaluations page pass-rate chart (`evaluation_passed` group, `platform/app/src/server/analytics/registry.ts:327-330`) | Pass rate computed client-side as `countIf(Passed = 1) / countIf(isNotNull(Passed))` per day (avoids a SQL divide-by-zero on days with no scored evaluations). `Passed` is `Nullable(Bool)` on `evaluation_metrics` (`lwqlViews.ts:1428`) — rows with no pass/fail outcome (score-only evaluators) are excluded from the denominator, same as legacy's pass-rate semantics. |
| 6 | `legacy-avg-traces-per-thread.json` | "Avg messages per thread", `platform/app/src/components/analytics/UserMetrics.tsx:26-34` (`metadata.thread_id` metric with `pipeline: { field: "thread_id", aggregation: "avg" }`) | Reproduces the pipeline aggregation as an explicit nested query: inner query counts traces per `(day, ConversationId)`, outer query averages that count per day. Proves the golden-set requirement for subquery pipelines. `ConversationId IS NOT NULL` filters out traces with no thread, matching legacy's `thread_id` requiring a key. |
| 7 | `legacy-top-models.json` | `metadata.model` groupBy, used e.g. in `platform/app/src/components/LLMMetrics.tsx:36` | `Models` is `Array(String)` per trace on `trace_metrics` (`lwqlViews.ts:923`); the widget unnests it with `arrayJoin` in a subquery, then groups by model with `uniqExact(TraceId)`. A trace using multiple models is counted once per model it used, matching how legacy's per-model groupBy attributes a multi-model trace to every model involved. Not time-bucketed (horizontal bar of top 10 in the window), matching the legacy chart's non-timeseries presentation. |
| 8 | `legacy-satisfaction-over-time.json` | Satisfaction/sentiment — no direct `registry.ts` metric maps to `SatisfactionScore`; closest legacy surface is the `sentiment.thumbs_up_down` metric (`platform/app/src/server/analytics/registry.ts:69-76`) | Uses `traces.SatisfactionScore` (`lwqlViews.ts:207`, `Nullable(Float64)`, ungated) rather than `annotations.IsThumbsUp`, because `SatisfactionScore` is a derived per-trace score already on the row (`avg()` per day is a clean aggregation), while `IsThumbsUp` is a *rare, human-only* signal (one row per manual annotation) whose day-bucketed rate would be sparse/misleading days apart from active review sessions. This is a genuine semantic delta from the legacy thumbs-up/down metric, not a like-for-like reproduction — call it out to reviewers. |

## Deliberately excluded

- **Topics charts** (legacy `analyticsGroups.topics`, `registry.ts:307-309`)
  are intentionally excluded from the golden set. `traces` / `trace_metrics`
  carry `TopicId` / `SubTopicId` (`lwqlViews.ts:213-224`, `1362`), but the
  catalog has no topic-name lookup view — resolving a topic id to its display
  name is unresolved for lwql today, so a "top topics" widget could only show
  opaque ids. Revisit once a `topics` (or similarly named) catalog view exists.

## Files

- `legacy-*.json` — the 8 widget definitions (`{ name, code, queries }`),
  one file per widget, ready to hand to `seed.mjs` or `langwatch playground-widget create`.
- `seed.mjs` — creates all 8 widgets in a project via the REST API
  (`POST /api/v1/projects/{projectId}/analytics/playground-widgets`, see
  `platform/app/src/app/api/analytics-sql/[[...route]]/app.playground-widgets.v1.ts`).
  Configured via `LW_ENDPOINT`, `LW_API_KEY`, `PROJECT_ID` env vars. Lists
  existing widgets first and skips any whose name already matches, so
  re-running is idempotent-ish (it will not update a widget edited since the
  last seed — see the script's own doc comment).

## Ground truth cited

- `platform/app/src/server/analytics/lwql/catalog/lwqlViews.ts` — `trace_metrics` (lines ~818-1053), `evaluation_metrics` (~1348-1531), `traces` (~89-322).
- `platform/app/src/server/analytics/lwql/catalog/postgresViews.ts` — `annotations` (lines 74-135).
- `platform/app/src/server/analytics/registry.ts` — legacy metric/aggregation definitions.
- `platform/app/src/components/analytics/UserMetrics.tsx`, `platform/app/src/components/LLMMetrics.tsx` — legacy chart configs.
- `platform/app/src/features/custom-chart-playground/presets.ts`, `skills/recipes/playground-widgets/SKILL.mdx` — worked widget example and hook contract.
