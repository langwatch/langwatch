/**
 * SpendSpikeAnomalyEvaluator — pure-function decision-logic unit tests.
 *
 * Sergey commit 3d2404170 (step 3e-i) shipped the evaluator. This test
 * exercises the pure `evaluateSpendSpike` function with synthesised
 * inputs — no I/O, no testcontainers, deterministic + fast.
 *
 * Coverage:
 *   - Fire when current >= baseline * ratio AND baseline >= minBaselineUsd
 *     AND no open alert in window
 *   - Skip 'below_baseline' when baseline < minBaselineUsd (signal too small)
 *   - Skip 'below_threshold' when current < baseline * ratio
 *   - Skip 'dedup' when an open alert already covers the window
 *   - Edge: exact threshold equality fires
 *   - Edge: zero baseline + zero current → skip below_baseline (default
 *     minBaselineUsd > 0)
 *   - Edge: large ratio doesn't fire on small spikes
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature +
 *       specs/ai-gateway/governance/anomaly-detection.feature
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPEND_SPIKE_CONFIG,
  evaluateSpendSpike,
  type SpendSpikeThresholdConfig,
} from "../spendSpikeAnomalyEvaluator.service";

const FIXED_WINDOW_START = new Date("2026-04-29T10:00:00Z");
const FIXED_WINDOW_END = new Date("2026-04-29T11:00:00Z");

function input(overrides: {
  config?: Partial<SpendSpikeThresholdConfig>;
  currentSpendUsd: number;
  baselineSpendUsd: number;
  hasOpenAlertInWindow?: boolean;
}) {
  return {
    ruleId: "rule-1",
    organizationId: "org-1",
    config: { ...DEFAULT_SPEND_SPIKE_CONFIG, ...(overrides.config ?? {}) },
    currentSpendUsd: overrides.currentSpendUsd,
    baselineSpendUsd: overrides.baselineSpendUsd,
    hasOpenAlertInWindow: overrides.hasOpenAlertInWindow ?? false,
    windowStart: FIXED_WINDOW_START,
    windowEnd: FIXED_WINDOW_END,
  };
}

describe("evaluateSpendSpike — pure decision logic", () => {
  describe("when current spend is well above baseline + ratio", () => {
    it("fires when current >= baseline * ratio with baseline above minimum", () => {
      const result = evaluateSpendSpike(
        input({ currentSpendUsd: 10, baselineSpendUsd: 2 }),
      );
      expect(result.decision).toBe("fire");
      expect(result.currentSpendUsd).toBe(10);
      expect(result.baselineSpendUsd).toBe(2);
      expect(result.reason).toMatch(/Current.*≥.*threshold/);
    });

    it("fires at exact threshold equality", () => {
      const result = evaluateSpendSpike(
        input({ currentSpendUsd: 4, baselineSpendUsd: 2 }),
      );
      expect(result.decision).toBe("fire");
    });
  });

  describe("when baseline is below minBaselineUsd", () => {
    it("skips 'below_baseline' — signal too small to trigger", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 100,
          baselineSpendUsd: 0.5,
          config: { minBaselineUsd: 1.0 },
        }),
      );
      expect(result.decision).toBe("skip_below_baseline");
      expect(result.reason).toMatch(/Baseline.*minBaselineUsd/);
    });

    it("skips when both baseline and current are zero", () => {
      const result = evaluateSpendSpike(
        input({ currentSpendUsd: 0, baselineSpendUsd: 0 }),
      );
      expect(result.decision).toBe("skip_below_baseline");
    });
  });

  describe("when current spend is below threshold", () => {
    it("skips 'below_threshold' — current < baseline * ratio", () => {
      const result = evaluateSpendSpike(
        input({ currentSpendUsd: 3, baselineSpendUsd: 2 }),
      );
      expect(result.decision).toBe("skip_below_threshold");
      expect(result.reason).toMatch(/Current.*<.*threshold/);
    });

    it("skips with tight ratio that doesn't fire on small spikes", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 12,
          baselineSpendUsd: 10,
          config: { ratioVsBaseline: 1.5 },
        }),
      );
      // threshold = 10 * 1.5 = 15; current = 12 < 15 → skip
      expect(result.decision).toBe("skip_below_threshold");
    });

    it("fires with same numbers but lower ratio", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 12,
          baselineSpendUsd: 10,
          config: { ratioVsBaseline: 1.2 },
        }),
      );
      // threshold = 10 * 1.2 = 12; current = 12 >= 12 → fire
      expect(result.decision).toBe("fire");
    });
  });

  describe("dedup invariant", () => {
    it("skips 'dedup' when an open alert already covers this window", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 10,
          baselineSpendUsd: 2,
          hasOpenAlertInWindow: true,
        }),
      );
      expect(result.decision).toBe("skip_dedup");
      expect(result.reason).toMatch(/Existing open alert/);
    });

    it("dedup takes precedence over below_baseline check", () => {
      // Even when the spend is way too low to fire, we should NOT
      // re-evaluate the same window if an open alert exists. This
      // matters for re-evaluation on the next tick — we don't want to
      // surface a 'skip below_baseline' debug log when the real
      // reason is dedup.
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 0,
          baselineSpendUsd: 0,
          hasOpenAlertInWindow: true,
        }),
      );
      expect(result.decision).toBe("skip_dedup");
    });
  });

  describe("custom config", () => {
    it("uses provided minBaselineUsd to gate small-org noise", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 50,
          baselineSpendUsd: 5,
          config: { minBaselineUsd: 10 },
        }),
      );
      // baseline 5 < min 10 → skip even though 50 > 5*2
      expect(result.decision).toBe("skip_below_baseline");
    });

    it("custom ratioVsBaseline = 5.0 for high-confidence spikes only", () => {
      const result = evaluateSpendSpike(
        input({
          currentSpendUsd: 9,
          baselineSpendUsd: 2,
          config: { ratioVsBaseline: 5.0 },
        }),
      );
      // threshold = 2 * 5 = 10; current = 9 < 10 → skip
      expect(result.decision).toBe("skip_below_threshold");
    });

    it("returns the windowStart/End unchanged in the result", () => {
      const result = evaluateSpendSpike(
        input({ currentSpendUsd: 10, baselineSpendUsd: 2 }),
      );
      expect(result.windowStart).toBe(FIXED_WINDOW_START);
      expect(result.windowEnd).toBe(FIXED_WINDOW_END);
    });
  });
});
