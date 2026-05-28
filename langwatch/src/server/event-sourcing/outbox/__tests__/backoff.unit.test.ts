import { describe, expect, it } from "vitest";
import {
  calculateBackoffMs,
  DEFAULT_BACKOFF_CAP_MS,
} from "../backoff";

describe("calculateBackoffMs", () => {
  describe("given an attempt count of 0", () => {
    it("returns 0 (no backoff for an unattempted row)", () => {
      expect(calculateBackoffMs({ attempts: 0, random: () => 1 })).toBe(0);
    });
  });

  describe("given a deterministic random source", () => {
    it("doubles the exponential ceiling on each attempt", () => {
      const constantRandom = () => 1;
      expect(
        calculateBackoffMs({
          attempts: 1,
          baseMs: 1000,
          random: constantRandom,
        }),
      ).toBe(1000);
      expect(
        calculateBackoffMs({
          attempts: 2,
          baseMs: 1000,
          random: constantRandom,
        }),
      ).toBe(2000);
      expect(
        calculateBackoffMs({
          attempts: 5,
          baseMs: 1000,
          random: constantRandom,
        }),
      ).toBe(16000);
    });
  });

  describe("when the exponential exceeds the cap", () => {
    it("clamps to the cap", () => {
      const constantRandom = () => 1;
      const ms = calculateBackoffMs({
        attempts: 50,
        baseMs: 1000,
        random: constantRandom,
        capMs: 30 * 60 * 1000,
      });
      expect(ms).toBe(30 * 60 * 1000);
    });

    it("clamps to the default 30-minute cap when no override is provided", () => {
      const constantRandom = () => 1;
      const ms = calculateBackoffMs({ attempts: 50, random: constantRandom });
      expect(ms).toBe(DEFAULT_BACKOFF_CAP_MS);
    });
  });

  describe("when full jitter is applied", () => {
    it("returns a value between 0 and the exponential ceiling", () => {
      const minResult = calculateBackoffMs({
        attempts: 4,
        baseMs: 1000,
        random: () => 0,
      });
      const maxResult = calculateBackoffMs({
        attempts: 4,
        baseMs: 1000,
        random: () => 0.9999,
      });
      expect(minResult).toBe(0);
      expect(maxResult).toBeLessThanOrEqual(8000);
      expect(maxResult).toBeGreaterThan(7000);
    });
  });
});
