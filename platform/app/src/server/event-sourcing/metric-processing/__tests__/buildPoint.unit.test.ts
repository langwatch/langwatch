import { describe, expect, it } from "vitest";
import { gaugeMetric, prepare, requestForMetric } from "./fixtures";

describe("canonical point building", () => {
  describe("when the project sends a histogram data point with explicit bounds and bucket counts", () => {
    /** @scenario "A histogram keeps its bucket layout" */
    it("the stored point still reports those bounds and counts, and preserves sum/min/max", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: {
            name: "latency",
            unit: "ms",
            histogram: {
              dataPoints: [
                {
                  timeUnixNano: "1700000000000000000",
                  count: "3",
                  sum: 12.5,
                  min: 1,
                  max: 9.5,
                  explicitBounds: [1, 5, 10],
                  bucketCounts: ["0", "1", "1", "1"],
                },
              ],
            },
          },
        }),
      });

      expect(result.rejectedDataPoints).toBe(0);
      const point = result.accepted[0]!.dataPoint;
      expect(point.explicitBounds).toEqual([1, 5, 10]);
      expect(point.bucketCounts).toEqual(["0", "1", "1", "1"]);
      expect(point.sum).toBe(12.5);
      expect(point.min).toBe(1);
      expect(point.max).toBe(9.5);
    });
  });

  describe("when the project sends an integer data point", () => {
    /** @scenario "A typed value keeps its type" */
    it("reports an integer value and is not reported as a floating point value", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            dataPoints: [{ timeUnixNano: "1700000000000000000", asInt: "42" }],
          }),
        }),
      });

      const point = result.accepted[0]!.dataPoint;
      expect(point.valueType).toBe("int");
      expect(point.valueInt).toBe("42");
      expect(point.valueDouble).toBeNull();
    });
  });

  describe("given two receivers process the same data point", () => {
    /** @scenario "Metric identity does not depend on the machine that received it" */
    it("both derive the same identity for it, and the point is stored once", async () => {
      const request = requestForMetric({
        metric: gaugeMetric({
          dataPoints: [
            {
              timeUnixNano: "1700000000000000000",
              asDouble: 2.5,
              attributes: [{ key: "region", value: { stringValue: "eu" } }],
            },
          ],
        }),
      });

      const receiverA = await prepare({ request });
      const receiverB = await prepare({ request });

      const pointA = receiverA.accepted[0]!.dataPoint;
      const pointB = receiverB.accepted[0]!.dataPoint;

      // Both receivers derive the same PointId and SeriesId from the same
      // wire content, so a downstream ReplacingMergeTree collapses the two
      // deliveries into one stored row rather than two.
      expect(pointB.pointId).toBe(pointA.pointId);
      expect(pointB.seriesId).toBe(pointA.seriesId);
    });
  });
});
