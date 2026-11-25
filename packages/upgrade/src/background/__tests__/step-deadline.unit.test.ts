/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BLOCKING_STEP_DEADLINE_MS, stepDeadline } from "../step-deadline.ts";

describe("stepDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a step whose run neither finishes nor fails", () => {
    /** @scenario "A blocking step that passes its deadline is cut with an error naming the deadline" */
    it("aborts its signal and stops awaiting it, with an error naming the deadline", async () => {
      const reason = "blocking step identity:backfill passed its 30-minute deadline";
      const deadline = stepDeadline({
        signal: new AbortController().signal,
        deadlineMs: BLOCKING_STEP_DEADLINE_MS,
        reason,
      });
      const outcome = deadline.race(new Promise<never>(() => undefined)).catch(String);

      await vi.advanceTimersByTimeAsync(BLOCKING_STEP_DEADLINE_MS);

      expect(deadline.signal.aborted).toBe(true);
      expect(await outcome).toBe(`Error: ${reason}`);
      deadline.stop();
    });
  });

  describe("given a step that ends inside its deadline", () => {
    it("answers its result and leaves no timer behind once stopped", async () => {
      const deadline = stepDeadline({
        signal: new AbortController().signal,
        deadlineMs: 1_000,
        reason: "late",
      });

      expect(await deadline.race(Promise.resolve({ rows: 3 }))).toEqual({ rows: 3 });
      deadline.stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(deadline.signal.aborted).toBe(false);
    });
  });

  describe("given the run's own signal aborts first", () => {
    it("aborts the step's signal with the run's reason", () => {
      const run = new AbortController();
      const deadline = stepDeadline({ signal: run.signal, deadlineMs: 1_000, reason: "late" });

      run.abort(new Error("lease lost"));

      expect(String(deadline.signal.reason)).toBe("Error: lease lost");
      deadline.stop();
    });
  });
});
