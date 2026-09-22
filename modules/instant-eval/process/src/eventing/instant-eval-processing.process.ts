/**
 * The `instantEval` process-manager topology. No `keyBy`: the aggregate is the
 * run, so one instance is one run and its pages serialize against each other.
 * @see ./instant-eval-processing-evolution.process.ts
 */

import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  INSTANT_EVAL_EVENT_TYPES,
  type InstantEvalProcessingEvent,
} from "@langwatch/instant-eval-contract";

import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_PROCESS_INTENT_TYPES,
  instantEvalFinishIntentSchema,
  instantEvalJudgePageIntentSchema,
  instantEvalPlanIntentSchema,
} from "./instant-eval-processing-data.process.ts";
import {
  buildInstantEvalProcessEventView,
  handleInstantEvalCancelRequested,
  handleInstantEvalFinished,
  handleInstantEvalPageJudged,
  handleInstantEvalPlanned,
  handleInstantEvalRequested,
  instantEvalWake,
} from "./instant-eval-processing-evolution.process.ts";
import {
  createInstantEvalFinishHandler,
  createInstantEvalJudgePageHandler,
  createInstantEvalPlanHandler,
  INSTANT_EVAL_MAX_ATTEMPTS,
  INSTANT_EVAL_OUTBOX_BATCH_SIZE,
  INSTANT_EVAL_OUTBOX_LEASE_MS,
  type InstantEvalDispatchDeps,
} from "./instant-eval-processing.intent.ts";

export function instantEvalProcessManager(
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
      .on(INSTANT_EVAL_EVENT_TYPES.REQUESTED, handleInstantEvalRequested)
      .on(INSTANT_EVAL_EVENT_TYPES.PLANNED, handleInstantEvalPlanned)
      .on(INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED, handleInstantEvalPageJudged)
      .on(INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED, handleInstantEvalCancelRequested)
      .on(INSTANT_EVAL_EVENT_TYPES.FINISHED, handleInstantEvalFinished)
      .onWake(instantEvalWake)
      .toPayload(buildInstantEvalProcessEventView)
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
