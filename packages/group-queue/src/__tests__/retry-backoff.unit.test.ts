import { describe, expect, it } from "vitest";

import { getBackoffMs, JOB_RETRY_CONFIG } from "../groupQueue.ts";

describe("getBackoffMs", () => {
  describe("given the jitter's lowest draw", () => {
    it("retries at once, whatever the attempt", () => {
      expect(getBackoffMs(1, () => 0)).toBe(0);
      expect(getBackoffMs(12, () => 0)).toBe(0);
    });
  });

  describe("given a draw within the rung", () => {
    it("waits that share of the exponential rung", () => {
      expect(getBackoffMs(1, () => 0.5)).toBe(250);
      expect(getBackoffMs(3, () => 0.5)).toBe(1_000);
    });

    it("never waits past the backoff cap", () => {
      expect(getBackoffMs(40, () => 0.5)).toBe(JOB_RETRY_CONFIG.maxBackoffMs / 2);
    });
  });

  describe("given jobs that failed together on the same attempt", () => {
    it("spreads their retries over the rung instead of one instant", () => {
      const draws = [0.1, 0.4, 0.9];
      const waits = draws.map((draw) => getBackoffMs(5, () => draw));

      expect(new Set(waits).size).toBe(draws.length);
      for (const wait of waits) {
        expect(wait).toBeGreaterThanOrEqual(0);
        expect(wait).toBeLessThan(JOB_RETRY_CONFIG.backoffBaseMs * 2 ** 4);
      }
    });
  });

  describe("given the platform's own random source", () => {
    it("stays within the rung", () => {
      for (let draw = 0; draw < 100; draw += 1) {
        const wait = getBackoffMs(4);
        expect(wait).toBeGreaterThanOrEqual(0);
        expect(wait).toBeLessThan(JOB_RETRY_CONFIG.backoffBaseMs * 2 ** 3);
      }
    });
  });
});
