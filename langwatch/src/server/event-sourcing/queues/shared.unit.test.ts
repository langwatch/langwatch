import { describe, expect, it } from "vitest";
import { JOB_RETRY_CONFIG, getBackoffMs } from "./shared";

describe("JOB_RETRY_CONFIG", () => {
  it("uses the cluster-recovery-friendly budget", () => {
    expect(JOB_RETRY_CONFIG.maxAttempts).toBe(25);
    expect(JOB_RETRY_CONFIG.backoffBaseMs).toBe(500);
    expect(JOB_RETRY_CONFIG.maxBackoffMs).toBe(600_000);
  });
});

describe("getBackoffMs", () => {
  describe("when attempt is in the exponential range", () => {
    it("returns 500ms for attempt 1", () => {
      expect(getBackoffMs(1)).toBe(500);
    });

    it("doubles each attempt before hitting the cap", () => {
      expect(getBackoffMs(2)).toBe(1_000);
      expect(getBackoffMs(3)).toBe(2_000);
      expect(getBackoffMs(4)).toBe(4_000);
      expect(getBackoffMs(5)).toBe(8_000);
      expect(getBackoffMs(6)).toBe(16_000);
      expect(getBackoffMs(7)).toBe(32_000);
      expect(getBackoffMs(11)).toBe(512_000);
    });
  });

  describe("when attempt is in the capped range", () => {
    it("caps at maxBackoffMs (10 minutes)", () => {
      expect(getBackoffMs(12)).toBe(600_000);
      expect(getBackoffMs(20)).toBe(600_000);
      expect(getBackoffMs(25)).toBe(600_000);
    });
  });

  describe("cumulative retry budget", () => {
    it("provides at least 2 hours of total wait across all 24 backoff gaps", () => {
      let total = 0;
      for (let attempt = 1; attempt < JOB_RETRY_CONFIG.maxAttempts; attempt++) {
        total += getBackoffMs(attempt);
      }
      expect(total).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    });
  });
});
