import { describe, expect, it } from "vitest";
import { affectedRollupBuckets, buildMetricRollups } from "../rollup";
import { point } from "./fixtures/metric-point.fixtures";

function summary({
  timeUnixMs,
  count,
  sum,
}: {
  timeUnixMs: number;
  count: string;
  sum: number;
}) {
  return point({ timeUnixMs, metricKind: "summary", count, sum });
}

describe("summary rollups", () => {
  describe("when a bucket holds several summaries", () => {
    it("rolls up count and sum while leaving quantiles raw-only", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "summary",
            count: "2",
            sum: 5,
            summaryQuantilesJson: '[{"quantile":0.9,"value":4}]',
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "summary",
            count: "3",
            sum: 9,
            summaryQuantilesJson: '[{"quantile":0.9,"value":8}]',
          }),
        ],
      });
      expect(rows[0]).toMatchObject({ count: "3", sum: 9 });
      expect(rows[0]).not.toHaveProperty("quantiles");
    });
  });

  describe("when a summary arrives late", () => {
    // OTLP summaries report no temporality yet are always cumulative, so the
    // next sample differences this one. Keying the recompute on temporality
    // alone left that next bucket holding a stale delta.
    it("marks the next sample's bucket for recompute", () => {
      const first = summary({ timeUnixMs: 5_000, count: "10", sum: 100 });
      const late = summary({ timeUnixMs: 25_000, count: "18", sum: 180 });
      const next = summary({ timeUnixMs: 35_000, count: "20", sum: 200 });

      const affected = affectedRollupBuckets({
        points: [first, late, next],
        insertedPoint: late,
      });

      expect([...affected].sort((a, b) => a - b)).toEqual([0, 30_000]);
      const rows = buildMetricRollups({
        points: [first, late, next],
        affectedBuckets: affected,
      });
      // Without the late point the next bucket would have differenced 20
      // against 10 and reported 10; against 18 the true increment is 2.
      expect(rows[1]).toMatchObject({ bucketStartMs: 30_000, count: "2" });
    });
  });
});
