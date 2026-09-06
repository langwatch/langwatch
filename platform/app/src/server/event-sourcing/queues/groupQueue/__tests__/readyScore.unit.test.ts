import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fallbackReadyScore,
  isUsableReadyScore,
  MAX_SCORE_FUTURE_SKEW_MS,
  MAX_SCORE_PAST_SKEW_MS,
  MIN_PLAUSIBLE_EPOCH_MS,
  resolveReadyScore,
} from "../readyScore";

const NOW = 1_786_000_000_000; // 2026-08-05, comfortably above the backstop.

describe("resolveReadyScore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a score the queue cannot use as an eligibility time", () => {
    /**
     * The production defect and its two-sided sibling. `??` passed 0, so a job
     * staged at the epoch and the age gauge read `now - 0`, about 56 years. A
     * fixed floor alone would not catch the rest of this table: a
     * customer-supplied OTLP timestamp is unbounded in BOTH directions, and
     * 2021-01-01 clears any floor while still reading as years of backlog.
     */
    /** @scenario "a score outside the allowed skew around now falls back to the staging time" */
    it.each([
      ["zero", 0],
      ["not a number", Number.NaN],
      ["negative", -1],
      ["the unblock sentinel", 1],
      ["epoch seconds rather than milliseconds", 1_786_000_000],
      ["infinite", Number.POSITIVE_INFINITY],
      ["a Date rather than a number", new Date(NOW)],
      ["a numeric string", String(NOW)],
      ["a customer timestamp years in the past", Date.UTC(2021, 0, 1)],
      ["a customer clock years in the future", Date.UTC(2030, 0, 1)],
      ["just beyond the past skew", NOW - MAX_SCORE_PAST_SKEW_MS - 1],
      ["just beyond the future skew", NOW + MAX_SCORE_FUTURE_SKEW_MS + 1],
    ])("falls back to the staging time when the score is %s", (_label, score) => {
      expect(resolveReadyScore({ score })).toEqual({
        score: NOW,
        isRejected: true,
      });
    });

    it("falls back to the shared clock reading when one is supplied", () => {
      const shared = NOW - 5_000;

      expect(resolveReadyScore({ score: 0, nowMs: shared })).toEqual({
        score: shared,
        isRejected: true,
      });
    });
  });

  describe("given a score the producer never supplied", () => {
    /**
     * Absent is not a defect. `deferredOriginResolution` and `datasetNormalize`
     * carry no occurrence time by design, so scoring them at staging time is
     * the intended default - and reporting every one of them as a broken
     * producer would bury the signal the counter exists to carry.
     */
    /** @scenario "a payload with no occurrence time is scored at the staging time without being reported" */
    it.each([
      ["undefined", undefined],
      ["null", null],
    ])("scores at the staging time and does not report %s", (_label, score) => {
      expect(resolveReadyScore({ score })).toEqual({
        score: NOW,
        isRejected: false,
      });
    });
  });

  describe("given a score the queue can use", () => {
    /** @scenario "a plausible timestamp is staged unchanged" */
    it("passes the timestamp through untouched", () => {
      const occurredAt = NOW - 90_000;

      expect(resolveReadyScore({ score: occurredAt })).toEqual({
        score: occurredAt,
        isRejected: false,
      });
    });

    it.each([
      ["exactly on the past skew bound", NOW - MAX_SCORE_PAST_SKEW_MS],
      ["exactly on the future skew bound", NOW + MAX_SCORE_FUTURE_SKEW_MS],
      ["late but inside the past bound", NOW - 6 * 60 * 60 * 1000],
      ["a little ahead, as an unsynchronised client emits", NOW + 30_000],
    ])("accepts a score %s", (_label, score) => {
      expect(resolveReadyScore({ score })).toEqual({
        score,
        isRejected: false,
      });
    });
  });

  describe("given a batch whose scores are all unusable", () => {
    /** @scenario "a batch that falls back keeps its arrival order" */
    it("gives every payload the same fallback against one shared clock", () => {
      const resolved = [0, Number.NaN, Date.UTC(2021, 0, 1)].map(
        (score) => resolveReadyScore({ score, nowMs: NOW }).score,
      );

      expect(resolved).toEqual([NOW, NOW, NOW]);
    });
  });
});

describe("isUsableReadyScore", () => {
  describe("when the score sits one millisecond outside a bound", () => {
    it.each([
      ["past", NOW - MAX_SCORE_PAST_SKEW_MS - 1],
      ["future", NOW + MAX_SCORE_FUTURE_SKEW_MS + 1],
    ])("rejects it on the %s side", (_side, score) => {
      expect(isUsableReadyScore(score, NOW)).toBe(false);
    });
  });

  describe("when the clock it is judged against moves", () => {
    it("re-judges the same score against the new reading", () => {
      const score = NOW - MAX_SCORE_PAST_SKEW_MS;

      expect(isUsableReadyScore(score, NOW)).toBe(true);
      expect(isUsableReadyScore(score, NOW + 1)).toBe(false);
    });
  });
});

describe("fallbackReadyScore", () => {
  /**
   * The terminal step is checked, not trusted. A worker that boots before its
   * NTP sync reads `Date.now()` in 1970, and every score it staged would then
   * be "plausible" relative to that clock - the one case the relative bounds
   * structurally cannot catch.
   */
  /** @scenario "a fallback taken from an unsynchronised clock is itself bounded" */
  it("pins a pre-NTP clock reading to the backstop", () => {
    expect(fallbackReadyScore(57_000)).toBe(MIN_PLAUSIBLE_EPOCH_MS);
    expect(fallbackReadyScore(0)).toBe(MIN_PLAUSIBLE_EPOCH_MS);
  });

  it("returns a real clock reading unchanged", () => {
    expect(fallbackReadyScore(NOW)).toBe(NOW);
  });
});
