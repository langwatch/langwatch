import { describe, expect, it } from "vitest";

import {
  evaluationRetryDelayMs,
  isWithinEvaluationRetryWindow,
} from "../evaluation-retry-window.rules.ts";

const ISSUED = 1_700_000_000_000;
const TWO_HOURS_MS = 120 * 60_000;

describe("isWithinEvaluationRetryWindow", () => {
  describe("when the evaluation was issued inside the window", () => {
    /** @scenario "An evaluator called before the evaluator service is up is retried, not recorded as a failure" */
    it("retries", () => {
      expect(
        isWithinEvaluationRetryWindow({
          occurredAt: ISSUED,
          now: ISSUED + 30_000,
          windowMs: TWO_HOURS_MS,
        }),
      ).toBe(true);
    });
  });

  describe("when the window has passed since it was issued", () => {
    /** @scenario "An evaluator service that stays down is recorded as an error once the retry window ends" */
    it("stops retrying", () => {
      expect(
        isWithinEvaluationRetryWindow({
          occurredAt: ISSUED,
          now: ISSUED + TWO_HOURS_MS,
          windowMs: TWO_HOURS_MS,
        }),
      ).toBe(false);
    });
  });
});

describe("evaluationRetryDelayMs", () => {
  describe("when the evaluator service asked for five seconds", () => {
    /** @scenario "Attempts back off from five seconds, doubling, up to ten minutes" */
    it("waits five seconds after attempt 1, doubling with each attempt", () => {
      const delays = [1, 2, 3, 4].map((attempt) =>
        evaluationRetryDelayMs({ attempt, retryAfterMs: 5_000 }),
      );

      expect(delays).toEqual([5_000, 10_000, 20_000, 40_000]);
    });

    /** @scenario "Attempts back off from five seconds, doubling, up to ten minutes" */
    it("never waits more than ten minutes", () => {
      expect(evaluationRetryDelayMs({ attempt: 20, retryAfterMs: 5_000 })).toBe(600_000);
    });
  });

  describe("when the evaluator service asked for longer than the backoff", () => {
    /** @scenario "Attempts back off from five seconds, doubling, up to ten minutes" */
    it("waits as long as it asked, still at most ten minutes", () => {
      expect(evaluationRetryDelayMs({ attempt: 1, retryAfterMs: 30_000 })).toBe(30_000);
      expect(evaluationRetryDelayMs({ attempt: 1, retryAfterMs: 3_600_000 })).toBe(600_000);
    });
  });

  describe("when the evaluator service asked for nothing", () => {
    /** @scenario "Attempts back off from five seconds, doubling, up to ten minutes" */
    it("starts from five seconds", () => {
      expect(evaluationRetryDelayMs({ attempt: 1, retryAfterMs: undefined })).toBe(5_000);
    });
  });
});
