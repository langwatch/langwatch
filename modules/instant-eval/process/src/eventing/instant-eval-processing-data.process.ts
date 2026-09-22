/**
 * The `instantEval` process manager's state, intents and payload boundary, all
 * persisted verbatim: ids, counts and instants, never a statement or a verdict.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { INSTANT_EVAL_OUTCOMES } from "@langwatch/instant-eval-contract";
import { z } from "zod";

export const INSTANT_EVAL_PROCESS_NAME = "instantEval" as const;

export const INSTANT_EVAL_PROCESS_INTENT_TYPES = {
  PLAN: "plan",
  JUDGE_PAGE: "judgePage",
  FINISH: "finish",
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

/** What a run is doing. */
export const INSTANT_EVAL_PHASES = [
  "idle",
  "planning",
  "running",
  "cancelling",
  "terminal",
] as const;

export type InstantEvalPhase = (typeof INSTANT_EVAL_PHASES)[number];

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
});
export type InstantEvalFinishIntent = z.infer<typeof instantEvalFinishIntentSchema>;

/** What the process remembers between one input and the next. */
export interface InstantEvalProcessState {
  readonly phase: InstantEvalPhase;
  /** The page judged most recently. Zero before the first one. */
  readonly page: number;
  /** The trace id the last judged page ended on. */
  readonly cursor: string | null;
  /** The span id the last judged page ended on, for a span-keyed statement. */
  readonly cursorSpanId: string | null;
  readonly pageSize: number;
  readonly keyColumns: readonly string[];
  /** Rows the run may still judge. */
  readonly remaining: number;
  /** What the run has spent so far, summed from its pages. */
  readonly inputTokens: number;
  readonly requests: number;
  /** When the run last did something, which is what the stall wake measures. */
  readonly lastActivityAtMs: number;
  readonly cancelRequestedAtMs: number | null;
}

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
  lastActivityAtMs: 0,
  cancelRequestedAtMs: null,
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
  cursor: z.string().nullable().default(null),
  cursorSpanId: z.string().nullable().default(null),
  hasNextPage: z.boolean().default(false),
});

export type InstantEvalProcessEventView = z.infer<typeof instantEvalProcessEventViewSchema>;
