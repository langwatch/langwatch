/**
 * The `instantEval` process manager's state, intents and payload boundary, all
 * persisted verbatim: ids, counts and instants, never a statement or a verdict.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import { INSTANT_EVAL_OUTCOMES } from "@langwatch/instant-eval-contract";
import { z } from "zod";

export const INSTANT_EVAL_PROCESS_NAME = "instantEval" as const;

export const INSTANT_EVAL_PROCESS_INTENT_TYPES = {
  PLAN: "plan",
  JUDGE_PAGE: "judgePage",
  FINISH: "finish",
  BILL_LATE_PAGE: "billLatePage",
} as const;

/**
 * How long a run may go without a judged page before it is stopped. What this
 * catches is a pod that died holding the lease, which no retry covers.
 */
export const INSTANT_EVAL_STALL_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * How long a cancelled run is given to stop on its own. The page in flight
 * reads the cancellation and stops between chunks; this is the backstop for
 * when it does not, and it outlives a page.
 */
export const INSTANT_EVAL_CANCEL_GRACE_MS = 2 * 60 * 1000;

/**
 * How long a routed late page is held waiting for its run's finished event. The finish lands in
 * seconds, so a finish that has not landed by then failed to record it. The held pages are then
 * billed without it, so they are never lost. Longer than a finish's retries take.
 */
export const INSTANT_EVAL_LATE_PAGE_HOLD_MS = INSTANT_EVAL_STALL_THRESHOLD_MS;

/** What a run is doing. */
const INSTANT_EVAL_PHASES = ["idle", "planning", "running", "cancelling", "terminal"] as const;

export const instantEvalPlanIntentSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
});
export type InstantEvalPlanIntent = z.infer<typeof instantEvalPlanIntentSchema>;

export const instantEvalJudgePageIntentSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  page: z.number().int().positive(),
  /** The trace id the previous page ended on, or null for the first page. */
  afterTraceId: z.string().nullable(),
  /**
   * The span id the previous page ended on, null where a statement's rows are one
   * per trace: a span-keyed statement pages by the pair or it skips spans.
   */
  afterSpanId: z.string().nullable().default(null),
  pageSize: z.number().int().positive(),
  /** Rows the run may still judge, which bounds the last page. */
  remaining: z.number().int().nonnegative(),
  keyColumns: z.array(z.string()),
});
export type InstantEvalJudgePageIntent = z.infer<typeof instantEvalJudgePageIntentSchema>;

export const instantEvalFinishIntentSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  outcome: z.enum(INSTANT_EVAL_OUTCOMES),
  errorCode: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  /** The run's routed cost, summed from its pages; zero when it was not routed. */
  costNanoUsd: z.number().int().nonnegative().default(0),
  /** The input tokens the routed cost covers; the rest are priced at the published rate. */
  routedInputTokens: z.number().int().nonnegative().default(0),
});
export type InstantEvalFinishIntent = z.infer<typeof instantEvalFinishIntentSchema>;

/** A routed page that reported after its run finished, and what it spent. */
const instantEvalLatePageSchema = z.object({
  page: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
  costNanoUsd: z.number().int().nonnegative(),
  routedInputTokens: z.number().int().nonnegative(),
});

/**
 * Bills a routed page the finish did not count: its own spend row, then its cost and price on the
 * finished run's row. Emitted only once the run's finish is recorded, so the row adds it last.
 */
export const instantEvalBillLatePageIntentSchema = z.object({
  ...instantEvalLatePageSchema.shape,
  runId: z.string(),
  projectId: z.string(),
  /** Set when the run's finish never landed and the hold ran out, so the page bills without it. */
  isFinishMissing: z.boolean().optional(),
});
export type InstantEvalBillLatePageIntent = z.infer<typeof instantEvalBillLatePageIntentSchema>;

/** What the process remembers between one input and the next. */
export const instantEvalProcessStateSchema = z.object({
  phase: z.enum(INSTANT_EVAL_PHASES),
  /** The page judged most recently. Zero before the first one. */
  page: z.number(),
  /** The trace id the last judged page ended on. */
  cursor: z.string().nullable(),
  /** The span id the last judged page ended on, for a span-keyed statement. */
  cursorSpanId: z.string().nullable(),
  pageSize: z.number(),
  keyColumns: z.array(z.string()).readonly(),
  /** Rows the run may still judge. */
  remaining: z.number(),
  /** What the run has spent so far, summed from its pages. */
  inputTokens: z.number(),
  requests: z.number(),
  /** The routed cost so far, in nano-USD; a state persisted before the router reads zero. */
  costNanoUsd: z.number().default(0),
  routedInputTokens: z.number().default(0),
  /** When the run last did something, which is what the stall wake measures. */
  lastActivityAtMs: z.number(),
  cancelRequestedAtMs: z.number().nullable(),
  /** Whether the run's finished event has landed; a late page is billed only after it. */
  isFinishRecorded: z.boolean().default(false),
  /** Routed pages that reported after the run ended, waiting for its finish to be recorded. */
  unbilledLatePages: z.array(instantEvalLatePageSchema).default([]),
  /** When held late pages stop waiting and are billed without the finish; null when none wait. */
  lateHoldUntilMs: z.number().nullable().default(null),
});
export type InstantEvalProcessState = z.infer<typeof instantEvalProcessStateSchema>;

export const INITIAL_INSTANT_EVAL_STATE: InstantEvalProcessState = {
  phase: "idle",
  page: 0,
  cursor: null,
  cursorSpanId: null,
  pageSize: 0,
  keyColumns: [],
  remaining: 0,
  inputTokens: 0,
  requests: 0,
  costNanoUsd: 0,
  routedInputTokens: 0,
  lastActivityAtMs: 0,
  cancelRequestedAtMs: null,
  isFinishRecorded: false,
  unbilledLatePages: [],
  lateHoldUntilMs: null,
};

/**
 * The view of an event the process is given: persisted as JSON, so every
 * optional field is `null` rather than absent and a new one carries a default.
 */
export const instantEvalProcessEventViewSchema = z.object({
  runId: z.string(),
  rowLimit: z.number().default(0),
  questions: z.number().default(0),
  total: z.number().default(0),
  pageSize: z.number().default(0),
  keyColumns: z.array(z.string()).default([]),
  page: z.number().default(0),
  rows: z.number().default(0),
  failed: z.number().default(0),
  skipped: z.number().default(0),
  inputTokens: z.number().default(0),
  requests: z.number().default(0),
  costNanoUsd: z.number().default(0),
  routedInputTokens: z.number().default(0),
  cursor: z.string().nullable().default(null),
  cursorSpanId: z.string().nullable().default(null),
  hasNextPage: z.boolean().default(false),
});

export type InstantEvalProcessEventView = z.infer<typeof instantEvalProcessEventViewSchema>;
