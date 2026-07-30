import { describe, expect, it } from "vitest";
import {
  affectedRollupBuckets,
  buildMetricRollups,
} from "../rollup/buildRollups";
import type { MetricRollupRow } from "../schema";
import { point } from "./fixtures";

/**
 * `updatedAt` is stamped from the wall clock on every recompute (it is a
 * `writtenAt`-role column, not part of the bucket's derived value), so it is
 * expected to differ across calls and must not be part of an
 * idempotency comparison.
 */
function withoutUpdatedAt(rows: MetricRollupRow[]) {
  return rows.map(({ updatedAt: _updatedAt, ...rest }) => rest);
}

describe("metricTimeRollup recompute", () => {
  describe("given a series already has points either side of a rollup window", () => {
    /** @scenario "A late point corrects the summaries around it" */
    it("when a point arrives late for that window, the summaries covering it reflect the late point, and untouched windows are unchanged", () => {
      const cumulative = (timeUnixMs: number, value: number) =>
        point({
          timeUnixMs,
          metricKind: "sum",
          aggregationTemporality: "cumulative",
          isMonotonic: true,
          valueDouble: value,
        });
      // Two windows already exist (bucket 0 and bucket 30_000); "late" is a
      // point for bucket 0 that arrives after "decreased" (bucket 30_000)
      // was already processed.
      const first = cumulative(5_000, 10);
      const second = cumulative(15_000, 15);
      const decreased = cumulative(35_000, 3);
      const late = cumulative(25_000, 18);

      const affected = affectedRollupBuckets({
        points: [first, second, decreased, late],
        insertedPoint: late,
      });
      expect([...affected].sort((a, b) => a - b)).toEqual([0, 30_000]);

      const rows = buildMetricRollups({
        points: [first, second, decreased, late],
        affectedBuckets: affected,
      });
      const byBucket = new Map(rows.map((row) => [row.bucketStartMs, row]));

      // Bucket 0 now reflects the late point's contribution.
      expect(byBucket.get(0)).toMatchObject({ sum: 18, count: "3" });
      // Bucket 30_000 is recomputed because "decreased" differences against
      // whichever point now precedes it — the late arrival changed that.
      expect(byBucket.get(30_000)).toMatchObject({ sum: 3, resetCount: 1 });
    });
  });

  describe("given a data point has already been processed", () => {
    /** @scenario "Reprocessing a point does not change the result" */
    it("processing the same point again leaves the stored point and its summaries unchanged", () => {
      const points = [
        point({ timeUnixMs: 1_000, valueDouble: 4 }),
        point({ timeUnixMs: 2_000, valueDouble: -1 }),
      ];

      const first = buildMetricRollups({ points });
      const second = buildMetricRollups({ points });

      expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
    });

    /** @scenario "Reprocessing a point does not change the result" */
    it("is stable across repeated recomputation of the same affected buckets", () => {
      const points = [
        point({ timeUnixMs: 1_000, valueDouble: 0 }),
        point({ timeUnixMs: 2_000, valueDouble: 6 }),
      ];
      const affected = new Set([0]);

      const first = buildMetricRollups({ points, affectedBuckets: affected });
      const second = buildMetricRollups({ points, affectedBuckets: affected });
      const third = buildMetricRollups({ points, affectedBuckets: affected });

      expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
      expect(withoutUpdatedAt(third)).toEqual(withoutUpdatedAt(first));
    });
  });
});
