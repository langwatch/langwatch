/**
 * The instant-eval-processing pipeline (ADR-137).
 *
 * One projection, five commands and one process manager. The projection keeps
 * the run's counters on its ClickHouse row, which is what a caller polls; the
 * process manager owns the loop, which is plan, then a page at a time, then
 * finish.
 *
 * There is no map projection for the judgements, and that is deliberate: one
 * judged page becomes up to fifteen hundred ClickHouse rows and a map
 * projection is one record per event, so the page's own intent writes them
 * (idempotently, keyed into a replacing table) and the event carries only
 * counts. See the run executor's header for the full reasoning.
 *
 * @see ./process-manager/instantEval.process.ts
 * @see dev/docs/adr/137-instant-eval-run-is-a-judgment-job.md
 */

import { definePipeline } from "../../";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import {
  instantEvalPageDedupeId,
  RecordInstantEvalFinishedCommand,
  RecordInstantEvalPageJudgedCommand,
  RecordInstantEvalPlannedCommand,
  RequestInstantEvalCancelCommand,
  RequestInstantEvalRunCommand,
} from "./commands";
import {
  buildProcessEventView,
  handleCancelRequested,
  handlePageJudged,
  handleRunFinished,
  handleRunPlanned,
  handleRunRequested,
  instantEvalWake,
} from "./process-manager/instantEval.process";
import {
  createInstantEvalFinishHandler,
  createInstantEvalJudgePageHandler,
  createInstantEvalPlanHandler,
  INSTANT_EVAL_MAX_ATTEMPTS,
  INSTANT_EVAL_OUTBOX_BATCH_SIZE,
  INSTANT_EVAL_OUTBOX_LEASE_MS,
  type InstantEvalDispatchDeps,
} from "./process-manager/instantEvalIntentHandlers";
import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_PROCESS_INTENT_TYPES,
  INSTANT_EVAL_PROCESS_NAME,
  instantEvalFinishIntentSchema,
  instantEvalJudgePageIntentSchema,
  instantEvalPlanIntentSchema,
} from "./process-manager/instantEvalProcess.types";
import {
  createInstantEvalRunStateProjection,
  type InstantEvalRunProjectionState,
} from "./projections/instantEvalRun.stateProjection";
import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_EVENT_TYPES,
} from "./schemas/constants";
import type { InstantEvalProcessingEvent } from "./schemas/events";

/**
 * Only the executor dependencies are injected. The process-manager topology
 * itself is declared inline below, per ADR-052.
 */
export interface InstantEvalProcessingPipelineDeps {
  /** The run's counters, on its own ClickHouse row. */
  instantEvalRunStore: StateProjectionStore<InstantEvalRunProjectionState>;
  dispatch: InstantEvalDispatchDeps;
}

/**
 * The `instantEval` process-manager topology, exported standalone so a test can
 * build the exact definition the runtime mounts.
 *
 * No `keyBy`: the aggregate is the run, so the default process key is already
 * the run id and one instance is one run. Different runs of one project
 * therefore proceed in parallel, while a run's own pages serialize, which is
 * what the cursor requires.
 */
export function instantEvalPM(
  dispatch: InstantEvalDispatchDeps,
): ProcessManagerApplier<InstantEvalProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_INSTANT_EVAL_STATE)
      .intent(
        INSTANT_EVAL_PROCESS_INTENT_TYPES.PLAN,
        instantEvalPlanIntentSchema,
        createInstantEvalPlanHandler(dispatch),
      )
      .intent(
        INSTANT_EVAL_PROCESS_INTENT_TYPES.JUDGE_PAGE,
        instantEvalJudgePageIntentSchema,
        createInstantEvalJudgePageHandler(dispatch),
      )
      .intent(
        INSTANT_EVAL_PROCESS_INTENT_TYPES.FINISH,
        instantEvalFinishIntentSchema,
        createInstantEvalFinishHandler(dispatch),
      )
      .on(INSTANT_EVAL_EVENT_TYPES.REQUESTED, handleRunRequested)
      .on(INSTANT_EVAL_EVENT_TYPES.PLANNED, handleRunPlanned)
      .on(INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED, handlePageJudged)
      .on(INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED, handleCancelRequested)
      .on(INSTANT_EVAL_EVENT_TYPES.FINISHED, handleRunFinished)
      .onWake(instantEvalWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: INSTANT_EVAL_MAX_ATTEMPTS,
        // Far longer than a healthy page, because a lease that expires
        // mid-flight lets a second dispatcher judge the same page and pay for
        // it twice.
        leaseDurationMs: INSTANT_EVAL_OUTBOX_LEASE_MS,
        // Pages of different runs, in flight together. Bounded near the batch
        // size because a page is slow enough that leased-but-waiting messages
        // would otherwise sit invisible behind the in-flight ones.
        concurrency: INSTANT_EVAL_OUTBOX_BATCH_SIZE,
        batchSize: INSTANT_EVAL_OUTBOX_BATCH_SIZE,
      });
}

export function createInstantEvalProcessingPipeline(
  deps: InstantEvalProcessingPipelineDeps,
) {
  return definePipeline<InstantEvalProcessingEvent>()
    .withName("instant_eval_processing")
    .withAggregateType(INSTANT_EVAL_AGGREGATE_TYPE)
    .withProjection(
      "instantEvalRun",
      createInstantEvalRunStateProjection({ store: deps.instantEvalRunStore }),
    )
    .withCommand("requestRun", RequestInstantEvalRunCommand)
    .withCommand("recordPlanned", RecordInstantEvalPlannedCommand)
    .withCommand("recordPageJudged", RecordInstantEvalPageJudgedCommand, {
      // Suppress a duplicate append for the same page at enqueue: a redelivered
      // page would otherwise write a second event the fold has to recognise.
      // TTL-bound and best-effort; the fold's own page guard is the backstop.
      deduplication: { makeId: instantEvalPageDedupeId, ttlMs: 60_000 },
    })
    .withCommand("requestCancel", RequestInstantEvalCancelCommand)
    .withCommand("recordFinished", RecordInstantEvalFinishedCommand)
    .withProcessManager(INSTANT_EVAL_PROCESS_NAME, instantEvalPM(deps.dispatch))
    .build();
}
