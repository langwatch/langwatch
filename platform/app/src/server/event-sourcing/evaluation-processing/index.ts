/**
 * The `evaluation-processing` pipeline (ADR-102), rewritten onto
 * `@langwatch/event-sourcing` and `@langwatch/clickhouse` — a greenfield
 * rewrite of `event-sourcing.old/pipelines/evaluation-processing/`, not a
 * port of it. See each module's own docblock for the reasoning; this file
 * only assembles what they declare and summarises what a reader needs before
 * diving in.
 *
 * === The aggregate ===
 *
 * One `evaluation` aggregate (`aggregate.ts`, ADR-105), two event types —
 * `started`, `reported` — matching what production actually mints today
 * (the old pipeline's `scheduled`/`completed` are retired dead code paths;
 * this is a new event log, so they are not carried forward — see
 * `aggregate.ts`'s docblock).
 *
 * === Defect prevention (see the task's driving brief) ===
 *
 * 1. **"A finished evaluation must not keep being counted as running."**
 *    Prevented at the fold level: `status` is monotone by rank over a
 *    two-value lattice (ADR-098 decision 4) — `applyStarted` in `aggregate.ts`
 *    refuses to move a terminal evaluation back to `in_progress`. Proven two
 *    ways: `aggregate.unit.test.ts` and `projections/evaluationAnalytics.fold.unit.test.ts`
 *    (the same regression through the real `createFoldExecutor`, with a
 *    delivery sequence the executor's own redelivery guard does NOT
 *    intercept — see that test's docblock). Reinforced structurally by
 *    `projections/evaluationAnalytics.table.ts`'s partition/TTL role-map
 *    (CreatedAt, never OccurredAt) and `evaluationAnalytics.store.ts`'s point-
 *    lookup read, which together make this fold's OWN read-back immune to
 *    the moving-partition-column mechanism the deployed table still carries
 *    (see Finding #1 below) — belt-and-braces, not the same mechanism twice.
 * 2. **"`evaluationTrigger` must not swallow a per-monitor dispatch failure."**
 *    The dispatch loop itself is `trace-processing/process-manager/evaluationTrigger*`
 *    — out of this pipeline's directory, and already durable per ADR-075
 *    (`specs/monitors/evaluation-dispatch-durability.feature`). This
 *    pipeline's own contribution: `services/executeEvaluation.ts`'s command
 *    handler no longer converts EVERY exception into a permanent `reported`
 *    event the way the old `ExecuteEvaluationCommand` did — only a
 *    customer-fixable failure is recorded as `skipped`; anything else is
 *    re-thrown, so the caller's at-least-once redelivery gets to retry a
 *    failure that might be transient, instead of the failure being recorded
 *    as silently "done". See that module's docblock, "Defect #1" section,
 *    and `executeEvaluation.unit.test.ts`'s matching scenario.
 *
 * === Two ClickHouse findings, reported rather than fixed (task brief) ===
 *
 * **Finding #1 — `evaluation_analytics` never received the storage-anchor
 * split `trace_analytics` got.** Confirmed against the deployed DDL
 * (`clickhouse/migrations/00041_create_evaluation_analytics.sql`) and the OLD
 * fold's own write path: `PARTITION BY toYearWeek(OccurredAt)`, and
 * `OccurredAt` is stamped from the LATEST folded event
 * (`state.LastEventOccurredAt`), so it moves forward forever — exactly the
 * role ADR-099 forbids from anchoring a partition, a TTL, or a dedup-subquery
 * bound. The live consequence is concrete, not theoretical: in
 * `app-layer/analytics/query-builders/eval-slim-timeseries-query.ts`,
 * `dedupedSlim()` bounds BOTH the outer scope and the inner dedup `GROUP BY`
 * subquery on this same moving column, so a windowed read can compute
 * `max(UpdatedAt)` over the wrong subset of an evaluation's versions and
 * return a stale, non-null, plausible row — an evaluation whose true latest
 * version is `reported`/terminal can read back as its earlier `started`/
 * in-progress version for as long as the two versions' `OccurredAt` values
 * straddle the query's time window. **Not fixed here**: closing it on the
 * deployed table needs a re-key migration (create new, backfill, `EXCHANGE
 * TABLES`), which touches `src/server/clickhouse/migrations/` — outside this
 * pipeline's directory and explicitly out of scope. This pipeline's own new
 * table declaration (`projections/evaluationAnalytics.table.ts`) role-maps the
 * anchor onto the real, already-deployed `CreatedAt` column instead (frozen at
 * genesis, platform-set — verified against
 * `event-sourcing.old/projections/abstractFoldProjection.ts`), the same move
 * `log-processing/table.ts` made for `log_records`' `AcceptedAt`. That fixes
 * THIS fold's own read-back; it does not, by itself, repair
 * `eval-slim-timeseries-query.ts`, which reads the deployed table under its
 * deployed DDL.
 *
 * **Finding #2 — `evaluation_analytics_rollup` is `AggregatingMergeTree`, and
 * ADR-099/ADR-106 close the `merge` store kind to new mounts unconditionally.**
 * Confirmed against the deployed DDL
 * (`00040_create_evaluation_analytics_rollup.sql`): `ENGINE =
 * AggregatingMergeTree()`, columns typed `SimpleAggregateFunction(sum, ...)`.
 * `packages/event-sourcing/src/mount/validateMount.ts`'s
 * `merge-closed-to-new-adopters` rule refuses ANY `store: "merge"` mount,
 * unconditionally, with no grandfathering mechanism — by design (ADR-106
 * decision 5: the property that makes the engine useful, many writes
 * collapsing into one aggregate, is the same property that makes a
 * write-identity/dedup key impossible, so there is no idempotency story a
 * mount could declare that would make this legal). **This rewrite does not
 * convert `evaluationAnalyticsRollup`.** Forcing it onto `merge` would not
 * mount; forcing it onto `append` or `replace` instead would be a real
 * redesign (ADR-099's own two exit routes: derive at read time, or `replace`
 * written with the whole bucket, which turns the rollup into a fold that
 * reads its bucket back before writing it) — out of scope for "check and
 * report", not attempted here.
 *
 * === A cross-cutting gap, reported and since closed mid-rewrite ===
 *
 * `validateMount`/`Mount`/`MountShape` were declared in
 * `packages/event-sourcing/src/mount/` but were NOT re-exported from that
 * package's `src/index.ts` as of this rewrite's start — confirmed by reading
 * the file, not assumed, at the time `projections/evaluationAnalytics.mount.ts`
 * was first written (it stated the mount shape as a plain literal with the
 * legality argued in its own docblock, rather than importing or
 * reimplementing the checker). A concurrent change to the shared package
 * (outside this pipeline's directory) has since added the export; that module
 * now calls the real `validateMount` and the workaround is a historical note
 * in its docblock.
 *
 * === What this rewrite does not cover ===
 *
 * The OLD pipeline's `EvaluationRunFoldProjection` (the FULL fold, writing
 * `evaluation_runs` — `Details`/`Error`/`ErrorDetails`/`Inputs` included) is
 * not converted here; this rewrite's `evaluationAnalytics` fold is the SLIM
 * projection only, matching the task brief's explicit focus on
 * `evaluation_analytics` and its rollup. The `triggerMatch` /
 * `billingMeterPoke` / `graphTriggerActivity` event subscribers the old
 * `pipeline.ts` mounted are automations/billing concerns belonging to their
 * own pipelines' directories, not re-created here.
 */

export type {
  EvaluationAggregate,
  EvaluationEvent,
  EvaluationReportedData,
  EvaluationStartedData,
  EvaluationState,
  EvaluationStatus,
} from "./aggregate";
export {
  EVALUATION_STATUSES,
  evaluationAggregate,
  evaluationReportedDataSchema,
  evaluationStartedDataSchema,
  evaluationStateSchema,
  isTerminalEvaluationStatus,
} from "./aggregate";
export {
  evaluationAggregateId,
  evaluationAnalyticsFoldGroupKey,
  evaluationReportCommandGroupKey,
  evaluationStartCommandGroupKey,
} from "./groupKey";
export {
  createEvaluationAnalyticsFoldExecutor,
  EVALUATION_ANALYTICS_PROJECTION_NAME,
} from "./projections/evaluationAnalytics.fold";
export {
  assertEvaluationAnalyticsMountIsLegal,
  evaluationAnalyticsMount,
} from "./projections/evaluationAnalytics.mount";
export {
  createEvaluationAnalyticsStore,
  evaluationStateFromRow,
  projectEvaluationStateToRow,
} from "./projections/evaluationAnalytics.store";
export type { EvaluationAnalyticsColumns } from "./projections/evaluationAnalytics.table";
export { evaluationAnalyticsTable } from "./projections/evaluationAnalytics.table";
export type {
  ExecuteEvaluationDeps,
  ExecuteEvaluationInput,
} from "./services/executeEvaluation";

export {
  executeEvaluation,
  executeEvaluationInputSchema,
} from "./services/executeEvaluation";
export { EVALUATION_PROCESSING_TYPE_STRINGS } from "./typeStrings.snapshot";
