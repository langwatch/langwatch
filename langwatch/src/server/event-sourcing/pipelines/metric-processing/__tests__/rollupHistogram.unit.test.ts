import { describe, expect, it } from "vitest";
import { buildMetricRollups } from "../rollup";
import { point } from "./fixtures/metric-point.fixtures";

describe("explicit histogram rollups", () => {
  describe("when bucket layouts differ across a bucket", () => {
    it("coarsens onto an exactly mergeable common boundary set", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "histogram",
            aggregationTemporality: "delta",
            count: "6",
            sum: 9,
            explicitBounds: [1, 2],
            bucketCounts: ["1", "2", "3"],
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "histogram",
            aggregationTemporality: "delta",
            count: "15",
            sum: 30,
            explicitBounds: [2, 4],
            bucketCounts: ["4", "5", "6"],
          }),
        ],
      });
      expect(rows[0]).toMatchObject({
        explicitBounds: [2],
        bucketCounts: ["7", "14"],
        count: "21",
        sum: 39,
      });
    });
  });

  describe("when cumulative histograms change layout", () => {
    it("coarsens both sides before subtracting them", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "histogram",
            aggregationTemporality: "cumulative",
            count: "6",
            sum: 9,
            explicitBounds: [1, 2],
            bucketCounts: ["1", "2", "3"],
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "histogram",
            aggregationTemporality: "cumulative",
            count: "10",
            sum: 15,
            explicitBounds: [2, 4],
            bucketCounts: ["5", "3", "2"],
          }),
        ],
      });

      expect(rows[0]).toMatchObject({
        explicitBounds: [2],
        bucketCounts: ["5", "5"],
        count: "10",
        sum: 15,
        resetCount: 0,
      });
    });
  });

  describe("when a cumulative histogram resets", () => {
    it("retains the extrema of the whole interval", () => {
      const rows = buildMetricRollups({
        points: [
          point({
            timeUnixMs: 1_000,
            metricKind: "histogram",
            aggregationTemporality: "cumulative",
            count: "10",
            min: 1,
            max: 9,
            explicitBounds: [5],
            bucketCounts: ["5", "5"],
          }),
          point({
            timeUnixMs: 2_000,
            metricKind: "histogram",
            aggregationTemporality: "cumulative",
            count: "2",
            min: 20,
            max: 30,
            explicitBounds: [5],
            bucketCounts: ["1", "1"],
          }),
        ],
      });

      expect(rows[0]).toMatchObject({
        count: "12",
        min: 1,
        max: 30,
        resetCount: 1,
      });
    });
  });
});
