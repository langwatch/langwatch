import { describe, expect, it } from "vitest";
import { prepare } from "./fixtures/canonical-metric.fixtures";

describe("canonical OTLP metric preparation", () => {
  describe("when a request carries every supported metric kind", () => {
    it("preserves each kind and its integer fidelity", async () => {
      const result = await prepare({
        request: {
          resourceMetrics: [
            {
              scopeMetrics: [
                {
                  scope: { name: "scope" },
                  metrics: [
                    {
                      name: "gauge",
                      gauge: {
                        dataPoints: [
                          {
                            timeUnixNano: "1700000000000000000",
                            asInt: "9223372036854775807",
                            flags: 1,
                          },
                        ],
                      },
                    },
                    {
                      name: "sum",
                      sum: {
                        aggregationTemporality: 2,
                        isMonotonic: true,
                        dataPoints: [
                          {
                            startTimeUnixNano: "1699999990000000000",
                            timeUnixNano: "1700000010000000000",
                            asDouble: 3.25,
                          },
                        ],
                      },
                    },
                    {
                      name: "histogram",
                      histogram: {
                        aggregationTemporality: 1,
                        dataPoints: [
                          {
                            timeUnixNano: "1700000020000000000",
                            count: "6",
                            sum: 12,
                            min: 0.5,
                            max: 4,
                            explicitBounds: [1, 2],
                            bucketCounts: ["1", "2", "3"],
                          },
                        ],
                      },
                    },
                    {
                      name: "exponential",
                      exponentialHistogram: {
                        aggregationTemporality: 1,
                        dataPoints: [
                          {
                            timeUnixNano: "1700000030000000000",
                            count: "4",
                            sum: 9,
                            scale: 2,
                            zeroThreshold: 0.001,
                            zeroCount: "1",
                            positive: { offset: -1, bucketCounts: ["1", "2"] },
                            negative: { offset: 3, bucketCounts: ["0"] },
                          },
                        ],
                      },
                    },
                    {
                      name: "summary",
                      summary: {
                        dataPoints: [
                          {
                            timeUnixNano: "1700000040000000000",
                            count: "5",
                            sum: 15,
                            quantileValues: [{ quantile: 0.9, value: 4.5 }],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(result.rejectedDataPoints).toBe(0);
      expect(result.accepted).toHaveLength(5);
      const points = Object.fromEntries(
        result.accepted.map(({ dataPoint }) => [
          dataPoint.metricName,
          dataPoint,
        ]),
      );
      expect(points.gauge).toMatchObject({
        metricKind: "gauge",
        valueType: "int",
        valueInt: "9223372036854775807",
        flags: 1,
        occurredAt: 1_700_000_000_000,
        acceptedAt: 1_800_000_000_000,
      });
      expect(points.sum).toMatchObject({
        metricKind: "sum",
        aggregationTemporality: "cumulative",
        isMonotonic: true,
        valueDouble: 3.25,
      });
      expect(points.histogram).toMatchObject({
        metricKind: "histogram",
        aggregationTemporality: "delta",
        count: "6",
        explicitBounds: [1, 2],
        bucketCounts: ["1", "2", "3"],
      });
      expect(points.exponential).toMatchObject({
        metricKind: "exponential_histogram",
        exponentialScale: 2,
        exponentialZeroThreshold: 0.001,
        zeroCount: "1",
        positiveOffset: -1,
        positiveBucketCounts: ["1", "2"],
      });
      expect(points.exponential!.canonicalPayload).toContain(
        '"zeroThreshold":0.001',
      );
      expect(points.summary).toMatchObject({
        metricKind: "summary",
        count: "5",
        sum: 15,
      });
      expect(points.summary!.summaryQuantilesJson).toContain('"quantile":0.9');
    });
  });

  describe("when a summary carries quantiles in mixed representations", () => {
    it("persists the same canonicalized quantiles the PointId hashes", async () => {
      const summaryWith = (quantileValues: unknown) => ({
        request: {
          resourceMetrics: [
            {
              scopeMetrics: [
                {
                  scope: { name: "scope" },
                  metrics: [
                    {
                      name: "summary",
                      summary: {
                        dataPoints: [
                          {
                            timeUnixNano: "1700000000000000000",
                            count: "5",
                            sum: 15,
                            quantileValues,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      const numeric = (
        await prepare(summaryWith([{ quantile: 0.9, value: 4.5 }]))
      ).accepted[0]!.dataPoint;
      const stringly = (
        await prepare(summaryWith([{ quantile: "0.9", value: "4.5" }]))
      ).accepted[0]!.dataPoint;

      // Same canonical content must mean the same identity AND the same stored
      // quantiles — a shared PointId with divergent rows would be a silent
      // last-writer-wins corruption.
      expect(stringly.pointId).toBe(numeric.pointId);
      expect(stringly.summaryQuantilesJson).toBe(numeric.summaryQuantilesJson);
      expect(numeric.summaryQuantilesJson).toBe(
        '[{"quantile":0.9,"value":4.5}]',
      );
    });
  });
});
