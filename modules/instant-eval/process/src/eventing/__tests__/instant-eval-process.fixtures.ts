/**
 * Shared fixtures for the Instant Eval process-state suites: a context whose
 * intent factories record what was asked for, a run mid-flight, and the payload
 * view a handler is given. Not a suite itself, so vitest does not collect it.
 * @see ../instant-eval-processing-evolution.process.ts
 */

import type { ProcessHandlerContext, ProcessIntent } from "@langwatch/eventing";

import {
  INITIAL_INSTANT_EVAL_STATE,
  type InstantEvalProcessEventView,
  type InstantEvalProcessState,
} from "../instant-eval-processing-data.process.ts";
import type { InstantEvalIntents } from "../instant-eval-processing-evolution.process.ts";

export const RUN_ID = "instanteval_1";
export const PROJECT_ID = "project-1";
export const NOW = 1_758_000_000_000;

/** A context whose intent factories record what was asked for. */
export function context(now = NOW): {
  emitted: ProcessIntent[];
  ctx: ProcessHandlerContext<InstantEvalIntents>;
} {
  const emitted: ProcessIntent[] = [];
  const factory =
    (intentType: string) =>
    (messageKey: string, payload: unknown): ProcessIntent => {
      const intent: ProcessIntent = {
        messageKey,
        intentType,
        payload: JSON.parse(JSON.stringify(payload)),
      };
      emitted.push(intent);

      return intent;
    };

  return {
    emitted,
    ctx: {
      at: now,
      now,
      key: RUN_ID,
      projectId: PROJECT_ID,
      // Keyed by the intent names the process declares, so a renamed intent
      // fails to typecheck here rather than silently recording nothing.
      intents: {
        plan: factory("plan"),
        judgePage: factory("judgePage"),
        finish: factory("finish"),
      },
    },
  };
}

export const running: InstantEvalProcessState = {
  ...INITIAL_INSTANT_EVAL_STATE,
  phase: "running",
  page: 1,
  cursor: "t500",
  pageSize: 500,
  keyColumns: ["ThreadId"],
  remaining: 700,
  inputTokens: 800,
  requests: 500,
  lastActivityAtMs: NOW,
};

export function view(
  overrides: Partial<InstantEvalProcessEventView> = {},
): InstantEvalProcessEventView {
  return {
    runId: RUN_ID,
    rowLimit: 10_000,
    questions: 2,
    total: 0,
    pageSize: 0,
    keyColumns: [],
    page: 0,
    rows: 0,
    failed: 0,
    skipped: 0,
    inputTokens: 0,
    requests: 0,
    cursor: null,
    cursorSpanId: null,
    hasNextPage: false,
    ...overrides,
  };
}
