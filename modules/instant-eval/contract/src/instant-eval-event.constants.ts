/**
 * Stable Instant Eval event and command identifiers. The aggregate is one RUN
 * and the queue lane is the tenant. @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

export const INSTANT_EVAL_EVENT_TYPES = {
  REQUESTED: "lw.obs.instant_eval.requested",
  PLANNED: "lw.obs.instant_eval.planned",
  PAGE_JUDGED: "lw.obs.instant_eval.page_judged",
  CANCEL_REQUESTED: "lw.obs.instant_eval.cancel_requested",
  FINISHED: "lw.obs.instant_eval.finished",
} as const;

export const INSTANT_EVAL_PROCESSING_EVENT_TYPES = [
  INSTANT_EVAL_EVENT_TYPES.REQUESTED,
  INSTANT_EVAL_EVENT_TYPES.PLANNED,
  INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED,
  INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED,
  INSTANT_EVAL_EVENT_TYPES.FINISHED,
] as const;

export type InstantEvalProcessingEventType = (typeof INSTANT_EVAL_PROCESSING_EVENT_TYPES)[number];

export const INSTANT_EVAL_COMMAND_TYPES = {
  REQUEST: "lw.obs.instant_eval.request",
  RECORD_PLANNED: "lw.obs.instant_eval.record_planned",
  RECORD_PAGE_JUDGED: "lw.obs.instant_eval.record_page_judged",
  REQUEST_CANCEL: "lw.obs.instant_eval.request_cancel",
  RECORD_FINISHED: "lw.obs.instant_eval.record_finished",
} as const;

export const INSTANT_EVAL_PROCESSING_COMMAND_TYPES = [
  INSTANT_EVAL_COMMAND_TYPES.REQUEST,
  INSTANT_EVAL_COMMAND_TYPES.RECORD_PLANNED,
  INSTANT_EVAL_COMMAND_TYPES.RECORD_PAGE_JUDGED,
  INSTANT_EVAL_COMMAND_TYPES.REQUEST_CANCEL,
  INSTANT_EVAL_COMMAND_TYPES.RECORD_FINISHED,
] as const;

export type InstantEvalProcessingCommandType =
  (typeof INSTANT_EVAL_PROCESSING_COMMAND_TYPES)[number];

/** The aggregate one run's events belong to. */
export const INSTANT_EVAL_AGGREGATE_TYPE = "instant_eval_run";

/** The pipeline those events flow through. */
export const INSTANT_EVAL_PIPELINE_NAME = "instant_eval_processing";

/** Event schema versions, calendar versioned. */
export const INSTANT_EVAL_EVENT_VERSIONS = {
  REQUESTED: "2026-09-18",
  PLANNED: "2026-09-18",
  PAGE_JUDGED: "2026-09-18",
  CANCEL_REQUESTED: "2026-09-18",
  FINISHED: "2026-09-18",
} as const;

/** Projection schema versions, calendar versioned. */
export const INSTANT_EVAL_PROJECTION_VERSIONS = {
  RUN: "2026-09-18",
} as const;

/** How a run ended. */
export const INSTANT_EVAL_OUTCOMES = ["finished", "failed", "cancelled"] as const;

export type InstantEvalOutcome = (typeof INSTANT_EVAL_OUTCOMES)[number];
