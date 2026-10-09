/**
 * Shared fixtures for the Instant Eval process-state suites: a context whose
 * intent factories record what was asked for, a run mid-flight, and the payload
 * view a handler is given.
 *
 * Not a suite itself, so vitest does not collect it.
 *
 * @see ../instantEval.process.ts
 */

import type { ProcessIntent } from "~/server/event-sourcing/process-manager/processManager.types";
import type {
  handleRunRequested,
  InstantEvalIntents,
} from "../instantEval.process";
import {
  INITIAL_INSTANT_EVAL_STATE,
  type InstantEvalProcessState,
} from "../instantEvalProcess.types";

export const RUN_ID = "instanteval_1";
export const NOW = 1_758_000_000_000;

/** A context whose intent factories record what was asked for. */
export function context(now = NOW) {
  const emitted: ProcessIntent[] = [];
  const factory =
    (intentType: string) =>
    (key: string, payload: unknown): ProcessIntent => {
      const intent = { messageKey: key, intentType, payload } as ProcessIntent;
      emitted.push(intent);
      return intent;
    };
  return {
    emitted,
    ctx: {
      at: now,
      now,
      key: RUN_ID,
      projectId: "project-1",
      // Keyed by the intent names the process declares, so a renamed intent
      // fails to typecheck here rather than silently recording nothing.
      intents: {
        plan: factory("plan"),
        judgePage: factory("judgePage"),
        finish: factory("finish"),
      } satisfies Record<keyof InstantEvalIntents, unknown>,
    } as unknown as Parameters<typeof handleRunRequested>[2],
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

export const view = (overrides: Record<string, unknown>) => ({
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
  hasNextPage: false,
  ...overrides,
});
