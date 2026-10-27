/**
 * The `instantEval` process-manager topology. No `keyBy`: the aggregate is the
 * run, so one instance is one run and its pages serialize against each other.
 * @see ./instant-eval-processing-evolution.process.ts
 */

import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  type InstantEvalProcessingEvent,
  instantEvalRequestedEventSchema,
  instantEvalPlannedEventSchema,
  instantEvalPageJudgedEventSchema,
  instantEvalCancelRequestedEventSchema,
  instantEvalFinishedEventSchema,
} from "@langwatch/instant-eval-contract";

import {
  INITIAL_INSTANT_EVAL_STATE,
  instantEvalProcessEventViewSchema,
  instantEvalProcessStateSchema,
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
      .state(instantEvalProcessStateSchema, INITIAL_INSTANT_EVAL_STATE)
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
      .toPayload(instantEvalProcessEventViewSchema, buildInstantEvalProcessEventView)
      .on(instantEvalRequestedEventSchema, handleInstantEvalRequested)
      .on(instantEvalPlannedEventSchema, handleInstantEvalPlanned)
      .on(instantEvalPageJudgedEventSchema, handleInstantEvalPageJudged)
      .on(instantEvalCancelRequestedEventSchema, handleInstantEvalCancelRequested)
      .on(instantEvalFinishedEventSchema, handleInstantEvalFinished)
      .onWake(instantEvalWake)
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
