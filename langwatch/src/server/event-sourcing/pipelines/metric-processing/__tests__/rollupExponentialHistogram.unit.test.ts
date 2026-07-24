import { describe, expect, it } from "vitest";
import { buildMetricRollups } from "../rollup";
import { MAX_DENSE_BUCKET_SPAN } from "../rollup/exponentialBuckets";
import { point } from "./fixtures/metric-point.fixtures";

/** At scale 0 the base is 2, so bucket i covers (2^i, 2^(i+1)]. */
function exponential(
  overrides: Parameters<typeof point>[0],
): ReturnType<typeof point> {
  return point({
    metricKind: "exponential_histogram",
    aggregationTemporality: "delta",
    exponentialScale: 0,
    exponentialZeroThreshold: 0,
    zeroCount: "0",
    positiveOffset: 0,
    ...overrides,
  });
}

describe("exponential histogram rollups", () => {
  describe("when scales differ across a bucket", () => {
    it("downscales before merging", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "exponential_histogram",
            aggregationTemporality: "delta",
            count: "10",
            exponentialScale: 2,
            zeroCount: "0",
            positiveOffset: 0,
            positiveBucketCounts: ["1", "2", "3", "4"],
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "exponential_histogram",
            aggregationTemporality: "delta",
            count: "11",
            exponentialScale: 1,
            zeroCount: "0",
            positiveOffset: 0,
            positiveBucketCounts: ["5", "6"],
          }),
        ],
      });
      expect(rows[0]).toMatchObject({
        exponentialScale: 1,
        positiveOffset: 0,
        positiveBucketCounts: ["8", "13"],
        count: "21",
      });
    });
  });

  describe("when cumulative exponential histograms change scale", () => {
    it("downscales both sides before subtracting them", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "exponential_histogram",
            aggregationTemporality: "cumulative",
            count: "10",
            exponentialScale: 2,
            exponentialZeroThreshold: 0,
            zeroCount: "0",
            positiveOffset: 0,
            positiveBucketCounts: ["1", "2", "3", "4"],
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "exponential_histogram",
            aggregationTemporality: "cumulative",
            count: "14",
            exponentialScale: 1,
            exponentialZeroThreshold: 0,
            zeroCount: "0",
            positiveOffset: 0,
            positiveBucketCounts: ["5", "9"],
          }),
        ],
      });

      expect(rows[0]).toMatchObject({
        exponentialScale: 1,
        positiveOffset: 0,
        positiveBucketCounts: ["5", "9"],
        count: "14",
        resetCount: 0,
      });
    });
  });

  describe("when zero thresholds differ across a bucket", () => {
    // OTel requires the merged histogram to adopt the largest zero_threshold
    // and fold every bucket it covers into the zero count. Unioning buckets
    // measured under different thresholds produces a row that is not a valid
    // exponential histogram at all.
    it("adopts the largest threshold and absorbs the buckets it covers", () => {
      const rows = buildMetricRollups({
        points: [
          exponential({
            timeUnixMs: 1_000,
            count: "8",
            exponentialZeroThreshold: 0,
            positiveBucketCounts: ["3", "5"],
          }),
          exponential({
            timeUnixMs: 2_000,
            count: "9",
            exponentialZeroThreshold: 4,
            zeroCount: "2",
            positiveOffset: 2,
            positiveBucketCounts: ["7"],
          }),
        ],
      });

      // Buckets 0 (1,2] and 1 (2,4] are inside the 4.0 threshold, so their 8
      // observations join the zero count; bucket 2 (4,8] survives.
      expect(rows[0]).toMatchObject({
        exponentialZeroThreshold: 4,
        zeroCount: "10",
        positiveOffset: 2,
        positiveBucketCounts: ["7"],
        count: "17",
      });
      // The row stays self-consistent: zeroCount + buckets == count.
      expect(10 + 7).toBe(Number(rows[0]!.count));
    });

    it("widens a threshold that would bisect a populated bucket", () => {
      const rows = buildMetricRollups({
        points: [
          exponential({
            timeUnixMs: 1_000,
            count: "5",
            exponentialZeroThreshold: 0,
            positiveBucketCounts: ["2", "3"],
          }),
          exponential({
            timeUnixMs: 2_000,
            count: "1",
            // 3.0 falls strictly inside bucket 1, which covers (2,4] — the
            // spec raises it to that bucket's upper bound rather than
            // splitting a count it cannot split.
            exponentialZeroThreshold: 3,
            positiveOffset: 2,
            positiveBucketCounts: ["1"],
          }),
        ],
      });

      expect(rows[0]).toMatchObject({
        exponentialZeroThreshold: 4,
        zeroCount: "5",
        positiveOffset: 2,
        positiveBucketCounts: ["1"],
        count: "6",
      });
    });

    it("differences a cumulative series across a mid-series threshold change", () => {
      const rows = buildMetricRollups({
        points: [
          exponential({
            timeUnixMs: 1_000,
            aggregationTemporality: "cumulative",
            count: "10",
            exponentialZeroThreshold: 0,
            positiveBucketCounts: ["4", "6"],
          }),
          exponential({
            timeUnixMs: 2_000,
            aggregationTemporality: "cumulative",
            count: "14",
            exponentialZeroThreshold: 2,
            zeroCount: "5",
            positiveOffset: 1,
            positiveBucketCounts: ["9"],
          }),
        ],
      });

      // Normalizing both sides to threshold 2 makes them comparable: the first
      // point's bucket 0 joins its zero count (4), so the delta is a real
      // increment rather than a spurious reset.
      expect(rows[0]).toMatchObject({
        exponentialZeroThreshold: 2,
        resetCount: 0,
        count: "14",
      });
    });
  });
  describe("when bucket offsets span the whole int32 range", () => {
    it("bounds the densified span instead of allocating across it", () => {
      const rows = buildMetricRollups({
        points: [
          exponential({
            timeUnixMs: 1_000,
            count: "1",
            positiveOffset: -2147483648,
            positiveBucketCounts: ["1"],
          }),
          exponential({
            timeUnixMs: 2_000,
            count: "1",
            positiveOffset: 2147483647,
            positiveBucketCounts: ["1"],
          }),
        ],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.count).toBe("2");
      expect(
        rows[0]!.positiveBucketCounts.length,
      ).toBeLessThanOrEqual(MAX_DENSE_BUCKET_SPAN);
      const totalBucketed = rows[0]!.positiveBucketCounts.reduce(
        (total, count) => total + BigInt(count),
        0n,
      );
      expect(totalBucketed).toBe(2n);
    });
  });
});
