# Analytics timestamp conversion: why it is a cross-module change

**Status: needs an owner decision, like the worker's. No lane can take it, and
four have tried.**

`modules/analytics` holds ~100 `temporal-only` findings. Four lanes have been
sent at them:

- the first took easy work elsewhere and left them;
- the second converted `LangWatchQLTimeWindow` to an invented `LangWatchQLInstant`
  without its callers, left 25 diagnostics against a baseline of 7, and was
  reverted;
- the third and fourth each judged the conversion too wide to finish and
  converted a single leaf instead.

The fourth was given an explicit mandate — map every caller first, convert in one
slice, or refuse and say what it spans. It refused, and this is the map. That is
the useful answer: **the conversion is not an analytics task.** Analytics' public
period values and its LWQL contract have `Date` callers in `modules/scenario`,
`modules/dashboard` and `modules/evaluation`, so any complete conversion edits
four modules at once, and any partial one leaves a Date-compatible facade that is
worse than either end state.

Nothing further should be spent on analytics' `temporal-only` findings until
someone decides to run that four-module change deliberately.

---

Recorded before any source edits. No timestamp conversion was applied.

The complete conversion is blocked by the analytics-only write scope: its public
period values and LWQL contract have Date callers in Scenario and Dashboard.
Keeping a Date-compatible public facade would leave a partial conversion.

## Declaration and boundary chains

- `contract/src/analytics.lwql-time-window.ts`: `LangWatchQLTimeWindow.start/end`
  and `formatLangWatchQLDateTimeParameter`; `analytics.lwql.ts` owns the coercing
  `lwqlTimeWindowSchema` and request types. Server time-window and query services,
  transports, browser executor/editor and their fixtures must change together.
  The import-free contract test also needs to account for the time dependency.
- `contract/src/analytics.query-shapes.ts`: `AnalyticsTimeseriesBuilderInput`;
  `server/src/repositories/analytics.repository.ts`: `AnalyticsTimeseriesQuery`;
  `server/src/services/analytics.service.ts`: date normalization and period math.
  ClickHouse repository/builders and their fixtures consume these inputs. Convert
  instants to Date only inside the ClickHouse persistence boundary.
- `contract/src/analytics.evaluation.ts`: rollup `bucketStart: z.date()`;
  evaluation persistence, memory implementations and fixtures consume the schema.
  The Evaluation projection owns the external rollup producer.
- `web/src/model/analytics-period.ts`: `AnalyticsPeriod`, range/preset functions;
  `web/src/behavior/use-analytics-period.ts`: period state and `setPeriod`;
  `web/src/ui/elements/period-selector.tsx`: separately exported `Period`, range
  functions, hook and picker. Both implementations and every consumer must change.
- Browser filter params, chart navigation, saved views, period pickers, workbench
  and dashboard widgets read dates or milliseconds from these period values.
- Saved chart/view dates originate in Dashboard-owned contracts:
  `modules/dashboard/contract/src/{saved-workbench-chart,saved-view}.ts`.
  Analytics REST serialization and optimistic saved-view records consume them.

## Confirmed changes required outside this lane

- `modules/scenario/web/src/behavior/agent-testing/use-scenario-period.ts:10`
  converts instants to Date before calling analytics `setPeriod`.
- `modules/scenario/web/src/ui/elements/agent-testing/shared/period-picker.tsx:64`
  calls `fromDate` on analytics picker callback values.
- `modules/scenario/web/src/behavior/agent-testing/results/use-run-plans.ts:27`
  and `:28` call `.getTime()` on analytics period fields.
- `modules/scenario/web/src/behavior/agent-testing/results/use-run-plan-batches.ts:35`
  and `use-widen-window-for-plan.ts:29` do the same.
- `modules/scenario/web/src/ui/sections/agent-testing/cases/__tests__/suites-rail.integration.test.tsx:66`
  passes `new Date()` to exported `computeRelativeWindow`.
- `modules/dashboard/server/src/services/__tests__/saved-workbench-chart-run.unit.test.ts`
  defines `WEEK` with Dates and supplies it to saved-chart execution.
- `modules/dashboard/contract/src/saved-workbench-chart.trpc.ts:76` consumes the
  LWQL schema; its app and transport carry the same window through to Analytics.
- `modules/evaluation/server/src/eventing/evaluation-analytics-rollup.projection.ts`
  owns rollup bucket production; its `ClickHouseMoment` must be checked against
  the converted Analytics rollup schema in the same slice.

## Analytics declaration, caller and fixture inventory

Paths relative to `modules/analytics/`; line numbers identify timestamp/period
references in the starting tree. ClickHouse entries include exempt persistence
Dates and fixtures requiring review when their input contracts change. SQL Date
vocabulary and display labels in this inventory are not conversion targets.

- `contract/src/analytics-lwql.schemas.ts`: 68
- `contract/src/analytics.evaluation.ts`: 41
- `contract/src/analytics.lwql-time-window.ts`: 7, 8, 9, 27, 104, 106, 111, 130, 131
- `contract/src/analytics.lwql.ts`: 2, 97, 98, 107, 114, 151, 169
- `contract/src/analytics.query-shapes.ts`: 8, 10, 11, 12
- `contract/src/langwatch-ql.errors.ts`: 289, 291
- `contract/src/visualization/__tests__/starter-vega-lite-spec.unit.test.ts`: 176
- `contract/src/visualization/starter-vega-lite-spec.ts`: 10
- `contract/src/visualization/vega-lite-expressions.ts`: 44
- `server/src/__tests__/evaluation-analytics.repository.integration.test.ts`: 18, 336
- `server/src/__tests__/migrated-clickhouse.harness.ts`: 130, 149, 150, 151, 195, 196
- `server/src/langwatch-ql/__tests__/lwql-clickhouse-harness.ts`: 454, 461, 556, 1156, 1170, 1203, 1802, 1809
- `server/src/langwatch-ql/__tests__/lwql-diagnostics.unit.test.ts`: 474, 498
- `server/src/langwatch-ql/__tests__/lwql-views.integration.test.ts`: 606
- `server/src/langwatch-ql/__tests__/lwqlGranularity.unit.test.ts`: 16, 19, 33, 34, 73, 75, 83, 86, 98, 100, 112, 114, 130, 132, 143, 146, 157, 160, 183, 186, 201, 203, 213, 215, 232, 234, 244, 246, 259, 261, 270, 272, 291, 293, 304, 306, 329, 330, 331, 337, 339, 341, 359, 360, 363, 365, 386, 387, 392, 394, 412, 413, 414, 416, 425, 426, 428, 430, 447, 472
- `server/src/langwatch-ql/__tests__/lwqlGranularityDeclaration.unit.test.ts`: 13, 15, 64, 72, 73, 79, 89, 96, 108, 122, 129
- `server/src/langwatch-ql/__tests__/lwqlTimeWindow.unit.test.ts`: 11, 13, 26, 27, 62, 72, 73, 84, 90, 102, 128, 130, 142, 145, 159, 161, 174, 177, 187, 199, 201, 213, 215, 230, 244, 247, 258, 271, 273, 288
- `server/src/langwatch-ql/__tests__/tenant-isolation.integration.test.ts`: 458
- `server/src/repositories/__tests__/analytics.service.unit.test.ts`: 13, 18, 19, 60, 70, 123, 124, 135, 136, 140, 141, 148, 157, 158, 161, 165, 172, 173, 176, 351
- `server/src/repositories/analytics.repository.ts`: 10, 14, 15, 16, 37
- `server/src/repositories/clickhouse/__tests__/aggregation-builder.test.ts`: 32, 33, 34, 1290, 1291, 1391, 1392, 1492, 1493
- `server/src/repositories/clickhouse/__tests__/attribute-metric-cte-scope.unit.test.ts`: 25, 26, 27
- `server/src/repositories/clickhouse/__tests__/builder-span-attributes.unit.test.ts`: 20, 21, 22
- `server/src/repositories/clickhouse/__tests__/column-pruning.test.ts`: 57, 58, 59
- `server/src/repositories/clickhouse/__tests__/evaluation-analytics.repository.unit.test.ts`: 105, 183, 200, 201, 202
- `server/src/repositories/clickhouse/__tests__/evaluation-runs-join-time-bounds.integration.test.ts`: 31, 32, 33
- `server/src/repositories/clickhouse/__tests__/event-metric-cte-scope.unit.test.ts`: 29, 30, 31
- `server/src/repositories/clickhouse/__tests__/join-time-bound-partition-column.unit.test.ts`: 188, 189, 190
- `server/src/repositories/clickhouse/__tests__/legacy-shim-forwarding.unit.test.ts`: 11, 25, 26, 27
- `server/src/repositories/clickhouse/__tests__/memory-safety-structural-invariants.unit.test.ts`: 19, 20, 21
- `server/src/repositories/clickhouse/__tests__/memory-safety.integration.test.ts`: 117, 118, 119
- `server/src/repositories/clickhouse/__tests__/metric-validation.unit.test.ts`: 22, 23, 24
- `server/src/repositories/clickhouse/__tests__/monitor-pass-rate.integration.test.ts`: 45, 84, 98, 99, 115, 116, 117, 131, 132
- `server/src/repositories/clickhouse/__tests__/result-parsing.test.ts`: 26, 27, 28, 63, 64, 65, 112, 113, 114, 164, 165, 166
- `server/src/repositories/clickhouse/__tests__/slim-rollup-builders.unit.test.ts`: 13, 14, 15
- `server/src/repositories/clickhouse/__tests__/timeseries-query.characterization.test.ts`: 7, 8, 9
- `server/src/repositories/clickhouse/clickhouse.aggregation-builder.mapper.ts`: 76, 202, 485, 486, 487, 2401, 2402, 2640, 2641, 2731, 2732
- `server/src/repositories/clickhouse/clickhouse.analytics-persistence.repository.ts`: 264, 265, 266, 293, 294, 295, 326, 343, 379, 381, 386
- `server/src/repositories/clickhouse/clickhouse.analytics.repository.ts`: 23, 27, 38, 83, 103, 147, 148, 210, 211
- `server/src/repositories/clickhouse/clickhouse.eval-rollup-timeseries-query.mapper.ts`: 10, 126
- `server/src/repositories/clickhouse/clickhouse.eval-slim-timeseries-query.mapper.ts`: 10, 147, 203
- `server/src/repositories/clickhouse/clickhouse.rollup-timeseries-query.mapper.ts`: 15, 128
- `server/src/repositories/clickhouse/clickhouse.slim-timeseries-query.mapper.ts`: 15, 204, 334
- `server/src/repositories/clickhouse/clickhouse.timeseries-query-shared.mapper.ts`: 101, 102, 106
- `server/src/repositories/dashboard-widgets/dashboardWidget.service.ts`: 8, 330, 331
- `server/src/rules/analytics-filter-conditions.rules.ts`: 447, 452, 453, 454, 461, 462, 469, 474, 481
- `server/src/rules/langwatch-ql-functions.rules.ts`: 116, 338
- `server/src/services/__tests__/analytics-comparison-window.service.unit.test.ts`: 11, 23, 36, 49, 62, 66, 68, 69, 70, 74, 75, 79, 80, 95, 108, 109
- `server/src/services/__tests__/legacy-filter-matching.unit.test.ts`: 537, 538, 539, 543
- `server/src/services/__tests__/precondition-trace-data.unit.test.ts`: 56, 57, 58, 59, 113, 114, 115, 116, 171, 172, 173, 174, 227, 228, 229, 230, 285, 286, 287, 288, 348, 349, 350, 351, 359
- `server/src/services/analytics-comparison-window.service.ts`: 8, 24, 27, 28, 29, 32, 33
- `server/src/services/analytics.service.ts`: 40, 41, 44, 45, 46, 68, 69, 79, 145, 146
- `server/src/services/langwatch-ql-bucket-diagnostics.service.ts`: 212, 220
- `server/src/services/langwatch-ql-time-window.service.ts`: 20, 21, 22, 32, 53, 55, 81, 181, 186, 191, 234, 235, 236, 248, 255, 256, 258, 285, 299, 358, 371, 399, 410
- `server/src/services/langwatch-ql.service.ts`: 34, 37, 46, 61, 67, 71, 90, 94, 138, 140, 228, 236, 271, 276, 279, 316, 325, 331
- `server/src/transport/__tests__/query-answerable-questions.integration.test.ts`: 79, 81, 727, 728
- `server/src/transport/analytics-lwql.trpc.ts`: 89
- `server/src/transport/query.rest.ts`: 104, 111
- `server/src/transport/saved-workbench-chart.rest.ts`: 126, 127
- `web/src/behavior/__tests__/use-analytics-period.unit.test.tsx`: 12, 28, 39, 41, 42, 45, 46, 60, 72, 75, 76, 91, 94, 95
- `web/src/behavior/analytics-api.ts`: 32, 47, 163
- `web/src/behavior/lwql-execute.ts`: 16, 38, 45, 47, 48, 49
- `web/src/behavior/use-analytics-period.ts`: 12, 13, 14, 18, 19, 20, 27, 31, 36, 43, 57, 58, 59, 60, 61, 70, 71
- `web/src/behavior/use-dashboard-widget-executor.ts`: 52, 66, 71, 101, 173, 176
- `web/src/behavior/use-dashboard-widget-in-place-editor.ts`: 17, 25, 39
- `web/src/behavior/use-filter-params.ts`: 20, 53, 134, 135, 157
- `web/src/behavior/use-langwatch-ql-query.ts`: 23, 36, 85
- `web/src/behavior/use-langwatch-ql-widget-run.ts`: 17, 19, 75
- `web/src/behavior/use-widget-preview.ts`: 23, 32, 68, 83
- `web/src/model/__tests__/analytics-period.unit.test.ts`: 14, 17, 24, 36, 44, 58, 67, 68, 77, 85, 86, 91, 108, 122
- `web/src/model/__tests__/lwql-value-format.unit.test.ts`: 175, 188
- `web/src/model/analytics-period.ts`: 9, 10, 33, 40, 44, 45, 55, 56, 64, 77, 78, 79, 88, 94, 96, 105, 106, 126, 127, 128
- `web/src/model/chart-date.ts`: 6, 19, 20
- `web/src/model/dashboard-widget/bridgeProtocol.ts`: 16
- `web/src/model/dashboard-widget/lwGlobalTypes.ts`: 27
- `web/src/model/lwql-language-items.ts`: 77
- `web/src/model/lwql-request-controller.ts`: 17, 30, 56, 91, 159, 160
- `web/src/model/lwql-request-state.ts`: 20, 23, 37, 99, 100, 140, 141, 142, 157, 176, 177, 207, 209, 210, 213
- `web/src/ui/blocks/__tests__/langwatch-ql-result-table.integration.test.tsx`: 66, 87, 95
- `web/src/ui/elements/__tests__/langwatch-ql-time-window-editor.integration.test.tsx`: 11, 14, 15, 28, 56, 130, 145
- `web/src/ui/elements/__tests__/use-period-selector.unit.test.ts`: 35, 55, 56, 58, 59, 61, 62
- `web/src/ui/elements/langwatch-ql-schema-browser.tsx`: 13
- `web/src/ui/elements/langwatch-ql-time-window-editor.tsx`: 10, 12, 22, 29, 32, 38, 50, 61, 64, 67, 72, 74, 77, 103, 141, 148, 161, 162, 174, 175
- `web/src/ui/elements/period-selector.tsx`: 10, 11, 39, 43, 44, 52, 59, 85, 89, 96, 97, 116, 136, 137, 138, 140, 141, 152, 153, 198, 199, 200, 219, 224, 227, 235, 259, 267, 322, 328, 332, 336, 340
- `web/src/ui/sections/DashboardWidgetFrame.tsx`: 51, 52, 55, 57, 58, 72, 82
- `web/src/ui/sections/DashboardWidgetInPlaceEditor.tsx`: 31, 43, 73
- `web/src/ui/sections/__tests__/draggable-graph-card.integration.test.tsx`: 71
- `web/src/ui/sections/__tests__/langwatch-ql-dashboard-widget.integration.test.tsx`: 20, 22, 23
- `web/src/ui/sections/__tests__/langwatch-ql-workbench.integration.test.tsx`: 175, 176, 269, 850, 854, 871, 917
- `web/src/ui/sections/__tests__/saved-views-logic.unit.test.ts`: 313, 333, 350, 365, 366, 392, 407, 408, 580
- `web/src/ui/sections/analytics-header.tsx`: 7, 8, 36, 103, 117
- `web/src/ui/sections/analytics-period-picker.tsx`: 9, 17, 18, 23, 27, 38, 39, 46, 59, 70, 73, 101, 107, 111, 115, 119
- `web/src/ui/sections/analytics/custom-graph.screen.tsx`: 65, 66, 105, 106, 304, 333, 708
- `web/src/ui/sections/custom-graph.tsx`: 47, 221, 297, 303, 949, 1064, 1065, 1067, 1068, 1499
- `web/src/ui/sections/draggable-graph-card.tsx`: 68, 97
- `web/src/ui/sections/feedbacks-table.tsx`: 35
- `web/src/ui/sections/langwatch-ql-dashboard-widget.tsx`: 56, 57, 63, 64
- `web/src/ui/sections/langwatch-ql-workbench-panel.tsx`: 6, 24, 27
- `web/src/ui/sections/langwatch-ql-workbench.tsx`: 18, 39, 46, 85, 332, 338, 349, 379, 492, 519, 520, 521, 522, 523, 525
- `web/src/ui/sections/saved-views-logic.ts`: 137, 138, 140
- `web/src/ui/sections/use-draggable-graph-card.ts`: 30, 33, 35, 36, 82
- `web/src/ui/sections/use-filter-params.ts`: 223, 224, 264, 266
- `web/src/ui/sections/use-saved-views.tsx`: 7, 265, 369, 370, 372, 401, 402
- `web/tests/browser/langwatch-ql-vega-chart-without-eval.browser.test.tsx`: 114, 115
- `web/tests/browser/langwatch-ql-vega-spec-network-silence.browser.test.tsx`: 50, 169, 170
- `web/tests/browser/langwatch-ql-workbench.browser.test.tsx`: 178, 179

## External consumers of the public period and LWQL symbols

- `modules/dashboard/contract/src/dashboard.api.ts`
- `modules/dashboard/contract/src/saved-workbench-chart.trpc.ts`
- `modules/dashboard/server/src/app/dashboard.app.ts`
- `modules/evaluator/web/src/ui/sections/checks/try-it-out.tsx`
- `modules/project/web/src/ui/sections/home/components/__tests__/traces-overview.integration.test.tsx`
- `modules/project/web/src/ui/sections/home/components/traces-overview.tsx`
- `modules/scenario/web/src/behavior/agent-testing/results/use-run-plan-batches.ts`
- `modules/scenario/web/src/behavior/agent-testing/results/use-run-plans.ts`
- `modules/scenario/web/src/behavior/agent-testing/results/use-widen-window-for-plan.ts`
- `modules/scenario/web/src/behavior/agent-testing/use-scenario-period.ts`
- `modules/scenario/web/src/ui/elements/agent-testing/shared/period-picker.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/__tests__/case-filing.integration.test.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/__tests__/case-modal.integration.test.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/__tests__/suites-rail.integration.test.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/case-recent-runs-button.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/cases-panel.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/cases-table.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/recent-runs-menu.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/suite-rail-menu.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/suite-rail.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/use-suite-recent-runs.ts`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/use-test-cases-data.ts`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/use-test-cases-tab.ts`
- `modules/scenario/web/src/ui/sections/agent-testing/cases/use-test-cases-view.ts`
- `modules/scenario/web/src/ui/sections/agent-testing/results/results-filter-row.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/results/results-list.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/results/run-plan-detail.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/results/run-plan-results-states.tsx`
- `modules/scenario/web/src/ui/sections/agent-testing/results/use-result-groups.ts`
- `modules/scenario/web/src/ui/sections/suites/external-set-detail-panel.tsx`
- `modules/scenario/web/src/ui/sections/suites/run-history-panel.tsx`
- `modules/scenario/web/src/ui/sections/suites/simulations-page.tsx`
- `modules/scenario/web/src/ui/sections/suites/suite-detail-panel.tsx`
