import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPlausibleReadyScore,
  MIN_PLAUSIBLE_EPOCH_MS,
  resolveReadyScore,
} from "../readyScore";

const NOW = 1_786_000_000_000; // 2026-08-05T...Z, comfortably above the floor.

describe("resolveReadyScore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a score function that cannot produce an occurrence time", () => {
    /**
     * The production defect: `??` passes 0, so a job staged at the epoch and
     * `gq_oldest_pending_age_milliseconds` read `now - 0`, about 56 years.
     */
    /** @scenario "a score that is not a plausible timestamp falls back to the current time" */
    it.each([
      ["zero", 0],
      ["not a number", Number.NaN],
      ["absent", undefined],
      ["null", null],
      ["negative", -1],
      ["the unblock sentinel", 1],
      ["epoch seconds rather than milliseconds", 1_786_000_000],
      ["infinite", Number.POSITIVE_INFINITY],
      ["a Date rather than a number", new Date(NOW)],
      ["a numeric string", String(NOW)],
    ])("falls back to the current time when the score is %s", (_label, score) => {
      expect(resolveReadyScore({ score })).toBe(NOW);
    });

    it("falls back to the shared clock reading when one is supplied", () => {
      const shared = NOW - 5_000;

      expect(resolveReadyScore({ score: 0, nowMs: shared })).toBe(shared);
    });
  });

  describe("given a score function that returns a real timestamp", () => {
    /** @scenario "a plausible timestamp is staged unchanged" */
    it("passes the timestamp through untouched", () => {
      const occurredAt = NOW - 90_000;

      expect(resolveReadyScore({ score: occurredAt })).toBe(occurredAt);
    });

    it("accepts a score sitting exactly on the plausible-epoch floor", () => {
      expect(resolveReadyScore({ score: MIN_PLAUSIBLE_EPOCH_MS })).toBe(
        MIN_PLAUSIBLE_EPOCH_MS,
      );
    });

    it("accepts a future score, which is how deferred and in-flight groups are marked", () => {
      const future = NOW + 600_000;

      expect(resolveReadyScore({ score: future })).toBe(future);
    });
  });

  describe("given a batch whose scores are all unusable", () => {
    /** @scenario "a batch that falls back keeps its arrival order" */
    it("gives every payload the same fallback so the per-index tiebreak orders them", () => {
      const sharedNow = NOW;
      const payloads = [0, Number.NaN, undefined];

      const scores = payloads.map((score, index) => {
        const resolved = resolveReadyScore({ score, nowMs: sharedNow });
        return resolved + index;
      });

      expect(scores).toEqual([sharedNow, sharedNow + 1, sharedNow + 2]);
    });
  });
});

describe("isPlausibleReadyScore", () => {
  describe("when the value is one millisecond below the floor", () => {
    it("rejects it", () => {
      expect(isPlausibleReadyScore(MIN_PLAUSIBLE_EPOCH_MS - 1)).toBe(false);
    });
  });

  describe("when the value is on the floor", () => {
    it("accepts it", () => {
      expect(isPlausibleReadyScore(MIN_PLAUSIBLE_EPOCH_MS)).toBe(true);
    });
  });
});
