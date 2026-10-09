/**
 * Event and command type constants for the instant-eval-processing pipeline
 * (ADR-137).
 *
 * Taxonomy: `lw.obs.instant_eval.<identifier>`, the aggregate is one run, so
 * `aggregateId` is the run id and every event of one run folds and subscribes
 * in order. The tenant is the project, and the commands group by it, because
 * judging is the expensive thing a tenant can ask for and it should queue
 * behind itself rather than fan out.
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

export type InstantEvalProcessingEventType =
  (typeof INSTANT_EVAL_PROCESSING_EVENT_TYPES)[number];

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
export const INSTANT_EVAL_AGGREGATE_TYPE = "instant_eval_run" as const;

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
export const INSTANT_EVAL_OUTCOMES = [
  "finished",
  "failed",
  "cancelled",
] as const;

export type InstantEvalOutcome = (typeof INSTANT_EVAL_OUTCOMES)[number];
