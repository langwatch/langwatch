/**
 * `experiment-run-processing` — the `experiment_run` aggregate, rewritten
 * onto `@langwatch/event-sourcing` and `@langwatch/clickhouse` (ADR-098,
 * ADR-099, ADR-100, ADR-103, ADR-105, ADR-106).
 *
 * ADR-103 names this pipeline as the worked example for "a run's totals are
 * a query": `experiment_run` state (`aggregate.ts`) holds only what belongs
 * to the run itself — which experiment, which targets, when it started,
 * stopped or finished — and every count, sum and rate a customer sees is
 * computed at read time from `experiment_run_items` (`totals.ts`), never
 * accumulated on the run row. There is nothing here for a redelivery to
 * double-count or a dropped update to under-count, because there is no
 * counter left to drift.
 *
 * Module map:
 * - `schema.ts` — the state shape and event payloads (no ClickHouse).
 * - `aggregate.ts` — the one `defineAggregate` declaration (events,
 *   commands) plus the composite aggregate-id helpers.
 * - `table.ts` / `store.ts` — the `experiment_runs` fold row: a hand-rolled
 *   `ReplaceStore`, because the deployed table is wide and per-field, not
 *   the single-JSON-blob shape `@langwatch/clickhouse`'s `createReplaceStore`
 *   expects (see `store.ts`'s module docblock).
 * - `itemsTable.ts` / `itemsStore.ts` / `itemsMapping.ts` — the
 *   `experiment_run_items` map projection: a hand-rolled `AppendStore`,
 *   because `OccurredAt` plays two structurally incompatible roles on the
 *   deployed table (ADR-099's own named debt for this table) that no
 *   `defineTable` declaration can honestly represent (see `itemsTable.ts`).
 *   `itemsMapping.ts` also closes this task's `ProjectionId` investigation:
 *   the old id hash omitted `ExperimentId`, which is the live data-loss
 *   defect ADR-103 names; this rewrite's hash includes it.
 * - `groupKey.ts` / `mount.ts` — the dispatch-plane descriptors (ADR-100)
 *   and the ADR-106 mount check for both projections.
 * - `totals.ts` — the derived-totals query.
 *
 * ## What this module does not include
 *
 * There is no `pipeline.ts` and no composition-root wiring — matching every
 * other pipeline already converted under this tree
 * (`log-processing/projection.ts`'s docblock states the same thing): ADR-102's
 * static pipeline builder has not been rewritten yet, so nothing in this
 * directory mounts onto a live dispatch runtime. What is exported below is
 * what a future composition root needs.
 *
 * There is no process manager. The old pipeline's `experimentRunExecution`
 * liveness process (ADR-103 decisions 5-6, `specs/experiments-v3/
 * experiment-run-liveness.feature`) is not reproduced here: `@langwatch/
 * event-sourcing`'s `src/index.ts` exports no process-manager primitive
 * today (no `defineProcess`, no durable-state port, no intent/outbox
 * types), so there is nothing in the package for this rewrite to build
 * against. This is flagged in this task's final report rather than answered
 * with a bespoke, package-external process-manager mechanism.
 */

export {
  type ExperimentRunAggregate,
  experimentRun,
  experimentRunAggregateId,
  parseExperimentRunAggregateId,
} from "./aggregate";
export {
  experimentRunResultStorageGroupKey,
  experimentRunStateGroupKey,
  renderExperimentRunResultStorageGroupKey,
  renderExperimentRunStateGroupKey,
} from "./groupKey";
export {
  generateItemProjectionId,
  mapEvaluatorResult,
  mapTargetResult,
} from "./itemsMapping";
export {
  createExperimentRunItemsStore,
  type ExperimentRunItemsStoreArgs,
} from "./itemsStore";

export {
  EXPERIMENT_RUN_ITEMS_TABLE_NAME,
  type ExperimentRunItemsRow,
  experimentRunItemsColumnNames,
  experimentRunItemsColumns,
} from "./itemsTable";
export {
  assertExperimentRunProcessingMountsAreLegal,
  experimentRunResultStorageMount,
  experimentRunStateMount,
} from "./mount";
export {
  createExperimentRunResultStorageProjection,
  createExperimentRunStateProjection,
  type ExperimentRunSourceEvent,
} from "./projection";
export {
  type EvaluatorResultData,
  type ExperimentRunItemRecord,
  type ExperimentRunState,
  type ExperimentRunTarget,
  evaluatorResultDataSchema,
  experimentRunStateSchema,
  experimentRunTargetSchema,
  initExperimentRunState,
  type RunCompletedData,
  type RunStartedData,
  runCompletedDataSchema,
  runStartedDataSchema,
  type TargetResultData,
  targetResultDataSchema,
} from "./schema";
export {
  createExperimentRunsStore,
  type ExperimentRunsStoreArgs,
} from "./store";
export { type ExperimentRunsRow, experimentRunsTable } from "./table";

export { deriveExperimentRunTotals, type ExperimentRunTotals } from "./totals";
