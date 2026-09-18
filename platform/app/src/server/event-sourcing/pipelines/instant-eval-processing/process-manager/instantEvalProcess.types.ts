/**
 * The `instantEval` process manager's state, intents and payload boundary.
 *
 * One instance per run: the process key is the aggregate id, which is the run
 * id, so a run's pages serialize against each other while different runs
 * proceed in parallel.
 *
 * ## HARD DATA BOUNDARY
 *
 * Everything in this file is persisted verbatim: the state into
 * `ProcessManagerInstance.state`, the intent payloads into
 * `ProcessManagerOutbox.payload`, and the event views into the inbox. So
 * nothing here carries a statement, a conversation or a judgement: only ids,
 * counts and timestamps. The intent that runs the statement reads it from the
 * run's own row, which is where it already lives.
 *
 * @see ./instantEval.process.ts: the pure logic over this state
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { z } from "zod";

import { INSTANT_EVAL_OUTCOMES } from "../schemas/constants";

export const INSTANT_EVAL_PROCESS_NAME = "instantEval" as const;

export const INSTANT_EVAL_PROCESS_INTENT_TYPES = {
  PLAN: "plan",
  JUDGE_PAGE: "judgePage",
  FINISH: "finish",
} as const;

/**
 * How long a run may go without a judged page before it is stopped.
 *
 * Fifteen minutes is far longer than a page takes: five hundred texts at the
 * platform's own rate is under a minute, and the outbox already retries a page
 * three times with backoff. What this catches is the case no retry covers: a
 * pod that died holding the lease, or a dispatch that never happened, where
 * the alternative is a run that says "running" forever.
 */
export const INSTANT_EVAL_STALL_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * How long a cancelled run is given to stop on its own.
 *
 * The page in flight reads the cancellation and stops between chunks, then its
 * own completion drives the finish. This is the backstop for when it does not:
 * two minutes, which outlives a page.
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

export const instantEvalJudgePageIntentSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  page: z.number().int().positive(),
  /** The trace id the previous page ended on, or null for the first page. */
  afterTraceId: z.string().nullable(),
  /**
   * The span id the previous page ended on.
   *
   * Null for a statement whose rows are one per trace. A statement projecting
   * `SpanId` has several rows per trace, so the page boundary is the pair and
   * a cursor on the trace alone would skip a trace's remaining spans.
   */
  afterSpanId: z.string().nullable().default(null),
  pageSize: z.number().int().positive(),
  /** Rows the run may still judge, which bounds the last page. */
  remaining: z.number().int().nonnegative(),
  keyColumns: z.array(z.string()),
});

export const instantEvalFinishIntentSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  outcome: z.enum(INSTANT_EVAL_OUTCOMES),
  errorCode: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});

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
 * The view of an event the process is given.
 *
 * Every field is optional-at-the-source as `null` rather than absent, because
 * the view is persisted as JSON and `undefined` does not survive the round
 * trip. New fields get a `.default(...)` so a row written by an older build
 * still parses instead of redelivering forever.
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

export type InstantEvalProcessEventView = z.infer<
  typeof instantEvalProcessEventViewSchema
>;
