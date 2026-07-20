import { describe, expect, it } from "vitest";
import { affectedRollupBuckets, buildMetricRollups } from "../rollup";
import { point } from "./fixtures/metric-point.fixtures";

describe("gauge and sum rollups", () => {
  describe("when a bucket holds several gauge samples", () => {
    it("retains gauge last/min/max/sum/count", () => {
      const rows = buildMetricRollups({
        points: [
          point({ timeUnixMs: 1_000, valueDouble: 4 }),
          point({ timeUnixMs: 2_000, valueDouble: -1 }),
          point({ timeUnixMs: 3_000, valueDouble: 7 }),
        ],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        bucketStartMs: 0,
        gaugeLast: 7,
        min: -1,
        max: 7,
        sum: 10,
        count: "3",
        sourcePointCount: 3,
      });
    });
  });

  describe("when a cumulative sum arrives late", () => {
    it("converts to deltas and revises the next bucket", () => {
      const cumulative = (timeUnixMs: number, value: number) =>
        point({
          timeUnixMs,
          metricKind: "sum",
          aggregationTemporality: "cumulative",
          isMonotonic: true,
          valueDouble: value,
        });
      const first = cumulative(5_000, 10);
      const second = cumulative(15_000, 15);
      const late = cumulative(25_000, 18);
      const decreased = cumulative(35_000, 3);
      const affected = affectedRollupBuckets({
        points: [first, second, late, decreased],
        insertedPoint: late,
      });

      expect([...affected]).toEqual([0, 30_000]);
      const rows = buildMetricRollups({
        points: [first, second, late, decreased],
        affectedBuckets: affected,
      });
      expect(rows[0]).toMatchObject({ sum: 18, count: "3" });
      expect(rows[1]).toMatchObject({
        bucketStartMs: 30_000,
        sum: 3,
        resetCount: 1,
      });
    });
  });

  describe("when a delta sum arrives late", () => {
    it("leaves the next bucket alone, since it derives nothing from this one", () => {
      const delta = (timeUnixMs: number, value: number) =>
        point({
          timeUnixMs,
          metricKind: "sum",
          aggregationTemporality: "delta",
          valueDouble: value,
        });
      const late = delta(25_000, 5);
      const next = delta(35_000, 6);

      expect([...affectedRollupBuckets({ points: [next], insertedPoint: late })]).toEqual([
        0,
      ]);
    });
  });

  describe("when a non-monotonic cumulative sum decreases", () => {
    it("does not invent a reset", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "sum",
            aggregationTemporality: "cumulative",
            isMonotonic: false,
            valueDouble: 10,
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "sum",
            aggregationTemporality: "cumulative",
            isMonotonic: false,
            valueDouble: 6,
          }),
        ],
      });

      expect(rows[0]).toMatchObject({ sum: 6, min: -4, max: 10, resetCount: 0 });
    });
  });

  describe("when two cumulative samples share a millisecond", () => {
    it("orders them by nanoseconds", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            pointId: "1".padStart(64, "0"),
            timeUnixMs: 1_000,
            timeUnixNano: "1000000000",
            metricKind: "sum",
            aggregationTemporality: "cumulative",
            isMonotonic: true,
            valueDouble: 10,
          }),
          point({
            pointId: "2".padStart(64, "0"),
            timeUnixMs: 1_000,
            timeUnixNano: "1000000001",
            metricKind: "sum",
            aggregationTemporality: "cumulative",
            isMonotonic: true,
            valueDouble: 12,
          }),
        ],
      });

      expect(rows[0]).toMatchObject({ sum: 12, resetCount: 0 });
    });
  });
  describe("when a valueless point follows a valid gauge sample", () => {
    it("keeps the last observed gauge value", () => {
      const rows = buildMetricRollups({
        points: [
          point({ timeUnixMs: 1_000, valueDouble: 4 }),
          point({ timeUnixMs: 2_000, valueType: "none" }),
        ],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ gaugeLast: 4 });
    });
  });
});
