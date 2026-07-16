import { describe, expect, it } from "vitest";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";
import { affectedRollupBuckets, buildMetricRollups } from "../rollup";

function point(
  overrides: Partial<CanonicalMetricDataPoint> & {
    timeUnixMs: number;
  },
): CanonicalMetricDataPoint {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    pointId: String(overrides.timeUnixMs).padStart(64, "0"),
    seriesId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: "metric",
    metricDescription: "",
    metricUnit: "1",
    metricKind: "gauge",
    aggregationTemporality: "unspecified",
    isMonotonic: null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: "1",
    timeUnixNano: String(BigInt(overrides.timeUnixMs) * 1_000_000n),
    flags: 0,
    valueType: "double",
    valueInt: null,
    valueDouble: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: null,
    positiveOffset: null,
    positiveBucketCounts: [],
    negativeOffset: null,
    negativeBucketCounts: [],
    summaryQuantilesJson: "[]",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: overrides.timeUnixMs,
    acceptedAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe("30-second metric rollups", () => {
  it("retains gauge last/min/max/sum/count", () => {
    const rows = buildMetricRollups([
      point({ timeUnixMs: 1_000, valueDouble: 4 }),
      point({ timeUnixMs: 2_000, valueDouble: -1 }),
      point({ timeUnixMs: 3_000, valueDouble: 7 }),
    ]);
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

  it("converts cumulative sums to deltas and revises the next bucket for late data", () => {
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
    const affected = affectedRollupBuckets(
      [first, second, late, decreased],
      late,
    );

    expect([...affected]).toEqual([0, 30_000]);
    const rows = buildMetricRollups([first, second, late, decreased], affected);
    expect(rows[0]).toMatchObject({ sum: 18, count: "3" });
    expect(rows[1]).toMatchObject({
      bucketStartMs: 30_000,
      sum: 3,
      resetCount: 1,
    });
  });

  it("allows a non-monotonic cumulative sum to decrease without inventing a reset", () => {
    const rows = buildMetricRollups([
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
    ]);

    expect(rows[0]).toMatchObject({
      sum: 6,
      min: -4,
      max: 10,
      resetCount: 0,
    });
  });

  it("orders cumulative samples by nanoseconds within the same millisecond", () => {
    const rows = buildMetricRollups([
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
    ]);

    expect(rows[0]).toMatchObject({ sum: 12, resetCount: 0 });
  });

  it("coarsens explicit histogram boundaries to an exactly mergeable common set", () => {
    const rows = buildMetricRollups([
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
    ]);
    expect(rows[0]).toMatchObject({
      explicitBounds: [2],
      bucketCounts: ["7", "14"],
      count: "21",
      sum: 39,
    });
  });

  it("coarsens cumulative histogram layouts before subtracting them", () => {
    const rows = buildMetricRollups([
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
    ]);

    expect(rows[0]).toMatchObject({
      explicitBounds: [2],
      bucketCounts: ["5", "5"],
      count: "10",
      sum: 15,
      resetCount: 0,
    });
  });

  it("retains extrema from a cumulative histogram reset", () => {
    const rows = buildMetricRollups([
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
    ]);

    expect(rows[0]).toMatchObject({
      count: "12",
      min: 1,
      max: 30,
      resetCount: 1,
    });
  });

  it("downscales exponential histograms before merging", () => {
    const rows = buildMetricRollups([
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
    ]);
    expect(rows[0]).toMatchObject({
      exponentialScale: 1,
      positiveOffset: 0,
      positiveBucketCounts: ["8", "13"],
      count: "21",
    });
  });

  it("downscales cumulative exponential histograms before subtracting them", () => {
    const rows = buildMetricRollups([
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
    ]);

    expect(rows[0]).toMatchObject({
      exponentialScale: 1,
      positiveOffset: 0,
      positiveBucketCounts: ["5", "9"],
      count: "14",
      resetCount: 0,
    });
  });

  it("rolls up summary count and sum while leaving quantiles raw-only", () => {
    const rows = buildMetricRollups([
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
    ]);
    expect(rows[0]).toMatchObject({ count: "3", sum: 9 });
    expect(rows[0]).not.toHaveProperty("quantiles");
  });
});
