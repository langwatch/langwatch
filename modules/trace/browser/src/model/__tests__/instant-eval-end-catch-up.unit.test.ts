/**
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_CATCH_UP_EVERY_MS,
  INSTANT_EVAL_CATCH_UP_WINDOW_MS,
  instantEvalCatchUpDelayMs,
  isAwaitingInstantEvalEnd,
} from "../instant-eval-end-catch-up.ts";

const run = (status: "running" | "finished", progress: number, total: number | null = 100) => ({
  status,
  progress,
  total,
});

describe("isAwaitingInstantEvalEnd", () => {
  /** @scenario "Only a run waiting on its end is read on a timer" */
  it("waits only on a judging run with nothing left to judge, or one the reader stopped", () => {
    expect(isAwaitingInstantEvalEnd({ run: run("running", 100), isStopRequested: false })).toBe(
      true,
    );
    expect(isAwaitingInstantEvalEnd({ run: run("running", 40), isStopRequested: true })).toBe(true);
    expect(isAwaitingInstantEvalEnd({ run: run("running", 40), isStopRequested: false })).toBe(
      false,
    );
    expect(isAwaitingInstantEvalEnd({ run: run("running", 0, null), isStopRequested: false })).toBe(
      false,
    );
    expect(isAwaitingInstantEvalEnd({ run: run("running", 0, 0), isStopRequested: false })).toBe(
      true,
    );
    expect(isAwaitingInstantEvalEnd({ run: run("finished", 100), isStopRequested: true })).toBe(
      false,
    );
  });

  it("backs off 1, 2, 4, then every 8 seconds, and stops after the window", () => {
    expect(
      [0, 1, 2, 3, 9].map((attempt) => instantEvalCatchUpDelayMs({ attempt, waitedMs: 0 })),
    ).toEqual([
      1_000,
      2_000,
      4_000,
      INSTANT_EVAL_CATCH_UP_EVERY_MS,
      INSTANT_EVAL_CATCH_UP_EVERY_MS,
    ]);
    expect(
      instantEvalCatchUpDelayMs({ attempt: 9, waitedMs: INSTANT_EVAL_CATCH_UP_WINDOW_MS }),
    ).toBeNull();
  });
});
