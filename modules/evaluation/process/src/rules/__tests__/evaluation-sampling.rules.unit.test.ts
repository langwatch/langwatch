/**
 * @see modules/evaluation/specs/monitor-evaluation-sampling.feature
 */
import { describe, expect, it } from "vitest";

import { evaluationSamplePosition, isEvaluationSampled } from "../evaluation-sampling.rules.ts";

const TRACE_COUNT = 100_000;
const traceIds = Array.from({ length: TRACE_COUNT }, (_, index) => `trace_${index.toString(36)}`);

const sampledFraction = (monitorId: string, sample: number): number =>
  traceIds.filter((traceId) => isEvaluationSampled({ traceId, monitorId, sample })).length /
  TRACE_COUNT;

describe("isEvaluationSampled", () => {
  describe("given the same trace and monitor", () => {
    /** @scenario "A retried or redelivered evaluation makes the same sampling decision" */
    it("answers the same every time, as a retry or redelivery would ask", () => {
      const input = { traceId: "trace_abc123", monitorId: "monitor_xyz", sample: 0.5 };
      const first = isEvaluationSampled(input);

      for (let attempt = 0; attempt < 20; attempt++) {
        expect(isEvaluationSampled(input)).toBe(first);
      }
      expect(evaluationSamplePosition(input)).toBe(evaluationSamplePosition({ ...input }));
    });
  });

  describe("given a sample rate of 0.5", () => {
    /** @scenario "Sampling applies correctly" */
    it("evaluates a fraction of 100,000 traces within 0.005 of 0.5", () => {
      expect(Math.abs(sampledFraction("monitor_a", 0.5) - 0.5)).toBeLessThan(0.005);
    });
  });

  describe.each([0.01, 0.1])("given a sample rate of %s", (sample) => {
    it("evaluates a fraction of 100,000 traces within 0.002 of the rate", () => {
      expect(Math.abs(sampledFraction("monitor_a", sample) - sample)).toBeLessThan(0.002);
    });
  });

  describe("given a sample rate of 0 or 1", () => {
    /** @scenario "Sample rates of 0 and 1 are exact" */
    it("never evaluates at 0 and always evaluates at 1", () => {
      expect(sampledFraction("monitor_a", 0)).toBe(0);
      expect(sampledFraction("monitor_a", 1)).toBe(1);
    });
  });

  describe("given two monitors at 0.5 over the same traces", () => {
    /** @scenario "Monitors sample the same traces independently" */
    it("samples each on its own, so they agree on about half the traces", () => {
      const agreed = traceIds.filter(
        (traceId) =>
          isEvaluationSampled({ traceId, monitorId: "monitor_a", sample: 0.5 }) ===
          isEvaluationSampled({ traceId, monitorId: "monitor_b", sample: 0.5 }),
      ).length;

      expect(Math.abs(agreed / TRACE_COUNT - 0.5)).toBeLessThan(0.01);
    });
  });

  describe("given a higher sample rate on the same monitor", () => {
    it("still evaluates every trace the lower rate evaluated", () => {
      const lower = traceIds
        .slice(0, 5_000)
        .filter((traceId) => isEvaluationSampled({ traceId, monitorId: "monitor_a", sample: 0.1 }));

      for (const traceId of lower) {
        expect(isEvaluationSampled({ traceId, monitorId: "monitor_a", sample: 0.3 })).toBe(true);
      }
    });
  });
});
