/**
 * What a measurement is called on the card.
 *
 * The most-asked questions in the product resolve to metric keys whose leaf is
 * not the thing being measured: "how many traces this week" counts distinct
 * `metadata.trace_id`, and both latency presets are `performance.completion_time`.
 * Titled from the key alone the first answers "Trace id" and the two latencies
 * are indistinguishable.
 *
 * Spec: dev/docs/best_practices/copywriting.md — copy says what the thing is
 * for the customer, never how it is built.
 */
import { describe, expect, it } from "vitest";

import { humanMetricLabel } from "../LangyMetricsCard";

describe("naming a measurement", () => {
  describe("given the metric people ask for most", () => {
    it("names what was counted, not the column it was counted on", () => {
      expect(humanMetricLabel("metadata.trace_id", "cardinality")).toBe(
        "Traces",
      );
    });
  });

  describe("given two presets that share one metric key", () => {
    // Both are `performance.completion_time`; only the aggregation separates
    // them, so titling from the key alone renders them identically.
    it("tells the average and the p95 apart", () => {
      const average = humanMetricLabel("performance.completion_time", "avg");
      const p95 = humanMetricLabel("performance.completion_time", "p95");

      expect(average).not.toBe(p95);
      expect(p95).toContain("P95");
    });
  });

  describe("given a metric with no name of its own", () => {
    it("still reads as words rather than a dotted key", () => {
      expect(humanMetricLabel("performance.first_token_ms", "avg")).toBe(
        "First token ms",
      );
    });

    it("falls back the same way when no aggregation is known", () => {
      expect(humanMetricLabel("performance.first_token_ms")).toBe(
        "First token ms",
      );
    });
  });

  describe("given no metric at all", () => {
    it("says something neutral rather than nothing", () => {
      expect(humanMetricLabel(undefined)).toBe("Metric");
    });
  });
});
