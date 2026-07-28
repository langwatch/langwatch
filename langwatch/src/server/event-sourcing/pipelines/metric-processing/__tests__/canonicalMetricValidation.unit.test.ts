import { describe, expect, it } from "vitest";
import {
  gaugeMetric,
  prepare,
  requestForMetric,
} from "./fixtures/canonical-metric.fixtures";

describe("canonical OTLP metric validation", () => {
  describe("when one data point in a metric is malformed", () => {
    it("rejects it without dropping its valid sibling", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            name: "partial.metric",
            dataPoints: [
              { asDouble: 1 },
              { timeUnixNano: "1700000000000000000", asDouble: 2 },
            ],
          }),
        }),
      });

      expect(result.accepted).toHaveLength(1);
      expect(result.rejectedDataPoints).toBe(1);
      expect(result.errors[0]).toContain("missing timeUnixNano");
    });
  });

  describe("when histogram buckets contradict the count", () => {
    it("rejects the inconsistent point before enqueueing", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: {
            name: "malformed.histogram",
            histogram: {
              aggregationTemporality: 1,
              dataPoints: [
                {
                  timeUnixNano: "1700000000000000000",
                  count: "3",
                  explicitBounds: [1],
                  bucketCounts: ["1", "1"],
                },
                {
                  timeUnixNano: "1700000001000000000",
                  count: "3",
                  explicitBounds: [1],
                  bucketCounts: ["1", "2"],
                },
              ],
            },
          },
        }),
      });

      expect(result.accepted).toHaveLength(1);
      expect(result.rejectedDataPoints).toBe(1);
      expect(result.errors[0]).toContain("must sum to count");
    });
  });

  describe("when a double data point is not finite", () => {
    // NaN and ±Infinity normalize to a NULL column. Accepting the point would
    // report success for a measurement that was silently discarded.
    it.each([
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
    ])("rejects the point rather than storing %s as null", async (_, value) => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            name: "nonfinite.metric",
            dataPoints: [{ timeUnixNano: "1700000000000000000", asDouble: value }],
          }),
        }),
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.rejectedDataPoints).toBe(1);
      expect(result.errors[0]).toContain("asDouble must be a finite number");
    });

    it("rejects a non-finite histogram sum", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: {
            name: "nonfinite.histogram",
            histogram: {
              aggregationTemporality: 1,
              dataPoints: [
                {
                  timeUnixNano: "1700000000000000000",
                  count: "1",
                  sum: Number.NaN,
                  explicitBounds: [],
                  bucketCounts: ["1"],
                },
              ],
            },
          },
        }),
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.rejectedDataPoints).toBe(1);
      expect(result.errors[0]).toContain(
        "histogram sum must be a finite number",
      );
    });
  });

  describe("when a number point carries an explicit null alongside a value", () => {
    it("keeps the value it actually has", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            name: "explicit.null",
            dataPoints: [
              {
                timeUnixNano: "1700000000000000000",
                asInt: null,
                asDouble: 5,
              },
            ],
          }),
        }),
      });

      expect(result.rejectedDataPoints).toBe(0);
      expect(result.accepted[0]!.dataPoint).toMatchObject({
        valueType: "double",
        valueDouble: 5,
        valueInt: null,
      });
    });
  });

  describe("when an exemplar timestamp exceeds the representable Date range", () => {
    // A point's own timeUnixNano is already bounded by UInt64 (~year 2554), so
    // an exemplar's unvalidated nanos are the only way a millisecond past the
    // ECMA-262 Date maximum (8.64e15) can reach a Date.
    it("rejects the point instead of deriving an Invalid Date", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            name: "overflow.exemplar",
            dataPoints: [
              {
                timeUnixNano: "1700000000000000000",
                asDouble: 1,
                exemplars: [
                  {
                    timeUnixNano: "9000000000000000000000",
                    asDouble: 1,
                    traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
                    spanId: "1122334455667788",
                  },
                ],
              },
            ],
          }),
        }),
      });

      expect(result.accepted).toHaveLength(0);
      expect(result.rejectedDataPoints).toBe(1);
      expect(result.errors[0]).toContain("outside the supported Date range");
    });

    it("accepts an exemplar at the Date maximum", async () => {
      const result = await prepare({
        request: requestForMetric({
          metric: gaugeMetric({
            name: "boundary.exemplar",
            dataPoints: [
              {
                timeUnixNano: "1700000000000000000",
                asDouble: 1,
                exemplars: [
                  {
                    timeUnixNano: "8640000000000000000000",
                    asDouble: 1,
                    traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
                    spanId: "1122334455667788",
                  },
                ],
              },
            ],
          }),
        }),
      });

      expect(result.rejectedDataPoints).toBe(0);
      expect(result.accepted[0]!.correlations[0]!.exemplarTimeUnixMs).toBe(
        8_640_000_000_000_000,
      );
    });
  });

  describe("when an OTLP container is not an array", () => {
    it.each([
      [
        "resourceMetrics",
        { resourceMetrics: { nested: "not-an-array" } },
        "resourceMetrics must be an array",
      ],
      [
        "scopeMetrics",
        { resourceMetrics: [{ scopeMetrics: { nested: 1 } }] },
        "scopeMetrics must be an array",
      ],
      [
        "metrics",
        { resourceMetrics: [{ scopeMetrics: [{ metrics: "nope" }] }] },
        "metrics must be an array",
      ],
    ])(
      "reports a controlled rejection for a malformed %s",
      async (_, request, message) => {
        const result = await prepare({ request });

        expect(result.accepted).toHaveLength(0);
        expect(result.rejectedDataPoints).toBe(1);
        expect(result.errors[0]).toContain(message);
      },
    );

    it("keeps preparing the valid siblings of a malformed container", async () => {
      const result = await prepare({
        request: {
          resourceMetrics: [
            { scopeMetrics: { nested: 1 } },
            {
              scopeMetrics: [
                {
                  scope: { name: "scope" },
                  metrics: [
                    gaugeMetric({
                      name: "survivor",
                      dataPoints: [
                        { timeUnixNano: "1700000000000000000", asDouble: 1 },
                      ],
                    }),
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]!.dataPoint.metricName).toBe("survivor");
      expect(result.rejectedDataPoints).toBe(1);
    });
  });
});
