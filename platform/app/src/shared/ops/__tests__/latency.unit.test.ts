import { describe, expect, it } from "vitest";
import {
  LATENCY_HISTOGRAM_BOUNDS_MS,
  LATENCY_HISTOGRAM_OVERFLOW_FIELD,
  latencyBucketField,
  mergeHistogramCounts,
  percentileFromHistogram,
  windowPercentiles,
} from "../latency";

describe("latencyBucketField", () => {
  describe("when a duration is bucketed", () => {
    /** @scenario "Completion durations land in the shared bucket grammar" */
    it("lands in the smallest bucket that holds it, with overflow past the largest bound", () => {
      expect(latencyBucketField(1)).toBe("1");
      expect(latencyBucketField(5)).toBe("6");
      expect(latencyBucketField(6)).toBe("6");
      expect(latencyBucketField(327)).toBe("384");
      const largest =
        LATENCY_HISTOGRAM_BOUNDS_MS[LATENCY_HISTOGRAM_BOUNDS_MS.length - 1]!;
      expect(latencyBucketField(largest)).toBe(String(largest));
      expect(latencyBucketField(largest + 1)).toBe(LATENCY_HISTOGRAM_OVERFLOW_FIELD);
    });
  });

  it("keeps the bounds strictly increasing so the walk terminates correctly", () => {
    for (let i = 1; i < LATENCY_HISTOGRAM_BOUNDS_MS.length; i++) {
      expect(LATENCY_HISTOGRAM_BOUNDS_MS[i]!).toBeGreaterThan(
        LATENCY_HISTOGRAM_BOUNDS_MS[i - 1]!,
      );
    }
  });
});

describe("percentileFromHistogram", () => {
  describe("when a percentile is computed from bucketed counts", () => {
    /** @scenario "A quantile reads from bucketed counts as a slight overestimate" */
    it("reports the upper bound of the bucket the rank falls in", () => {
      // 90 completions in the ≤256ms bucket, 10 in the ≤1536ms bucket:
      // P50 falls inside the first, P99 inside the second.
      const counts = new Map([
        ["256", 90],
        ["1536", 10],
      ]);
      expect(percentileFromHistogram(counts, 0.5)).toBe(256);
      expect(percentileFromHistogram(counts, 0.99)).toBe(1536);
    });
  });

  it("reports the largest finite bound for overflow-bucket ranks", () => {
    const counts = new Map([[LATENCY_HISTOGRAM_OVERFLOW_FIELD, 5]]);
    expect(percentileFromHistogram(counts, 0.99)).toBe(
      LATENCY_HISTOGRAM_BOUNDS_MS[LATENCY_HISTOGRAM_BOUNDS_MS.length - 1],
    );
  });

  describe("given a window holding no completions", () => {
    /** @scenario "A quiet window reports nothing rather than zero" */
    it("reports null, never a fabricated zero", () => {
      expect(percentileFromHistogram(new Map(), 0.5)).toBeNull();
      expect(windowPercentiles(new Map())).toBeNull();
    });
  });
});

describe("mergeHistogramCounts", () => {
  it("sums fields across hashes and drops non-numeric noise", () => {
    const merged = mergeHistogramCounts([
      { "256": "3", "1536": "1" },
      { "256": 2, junk: "not-a-number" },
    ]);
    expect(merged.get("256")).toBe(5);
    expect(merged.get("1536")).toBe(1);
    expect(merged.has("junk")).toBe(false);
  });
});
