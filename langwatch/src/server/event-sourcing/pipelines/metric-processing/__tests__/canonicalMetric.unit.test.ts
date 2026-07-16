import { describe, expect, it } from "vitest";
import {
  metricCommandGroupKey,
  prepareMetricDataPoints,
  resolveMetricCommandShardCount,
} from "../canonicalMetric";
import { createMetricProcessingPipeline } from "../pipeline";

const noRedaction = { redactMetricAttributes: async () => {} };

async function prepare(
  request: unknown,
  tenantId = "project-1",
  acceptedAt = 1_800_000_000_000,
) {
  return prepareMetricDataPoints({
    tenantId,
    organizationId: "organization-1",
    request: request as never,
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt,
  });
}

function requestForMetric(
  metric: Record<string, unknown>,
  args: {
    resourceAttributes?: unknown[];
    scopeAttributes?: unknown[];
  } = {},
) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: args.resourceAttributes ?? [] },
        schemaUrl: "resource-schema",
        scopeMetrics: [
          {
            scope: {
              name: "instrumentation",
              version: "1.2.3",
              attributes: args.scopeAttributes ?? [],
            },
            schemaUrl: "scope-schema",
            metrics: [metric],
          },
        ],
      },
    ],
  };
}

describe("canonical OTLP metric preparation", () => {
  it("preserves every supported OTLP metric kind and integer fidelity", async () => {
    const result = await prepare({
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
    });

    expect(result.rejectedDataPoints).toBe(0);
    expect(result.accepted).toHaveLength(5);
    const points = Object.fromEntries(
      result.accepted.map(({ dataPoint }) => [dataPoint.metricName, dataPoint]),
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

  it("keeps SeriesId stable across ordering/retries and excludes values and descriptions", async () => {
    const a = { key: "a", value: { stringValue: "one" } };
    const b = { key: "b", value: { intValue: "2" } };
    const build = (
      attributes: unknown[],
      value: number,
      description: string,
      resourceValue = "service-a",
    ) =>
      requestForMetric(
        {
          name: "identity.metric",
          unit: "ms",
          description,
          gauge: {
            dataPoints: [
              {
                timeUnixNano: "1700000000000000000",
                asDouble: value,
                attributes,
              },
            ],
          },
        },
        {
          resourceAttributes: [
            { key: "service.name", value: { stringValue: resourceValue } },
          ],
        },
      );

    const first = (await prepare(build([a, b], 1, "first"))).accepted[0]!
      .dataPoint;
    const reordered = (await prepare(build([b, a], 1, "first"))).accepted[0]!
      .dataPoint;
    const retried = (
      await prepare(build([a, b], 1, "first"), "project-1", 1_900_000_000_000)
    ).accepted[0]!.dataPoint;
    const valueChanged = (await prepare(build([a, b], 2, "first"))).accepted[0]!
      .dataPoint;
    const descriptionChanged = (await prepare(build([a, b], 1, "second")))
      .accepted[0]!.dataPoint;
    const attributesChanged = (
      await prepare(build([a, { ...b, value: { intValue: "3" } }], 1, "first"))
    ).accepted[0]!.dataPoint;
    const resourceChanged = (
      await prepare(build([a, b], 1, "first", "service-b"))
    ).accepted[0]!.dataPoint;
    const tenantChanged = (
      await prepare(build([a, b], 1, "first"), "project-2")
    ).accepted[0]!.dataPoint;

    expect(reordered.seriesId).toBe(first.seriesId);
    expect(reordered.pointId).toBe(first.pointId);
    expect(retried.seriesId).toBe(first.seriesId);
    expect(retried.pointId).toBe(first.pointId);
    expect(retried.acceptedAt).not.toBe(first.acceptedAt);
    expect(valueChanged.seriesId).toBe(first.seriesId);
    expect(valueChanged.pointId).not.toBe(first.pointId);
    expect(descriptionChanged.seriesId).toBe(first.seriesId);
    expect(descriptionChanged.pointId).not.toBe(first.pointId);
    expect(attributesChanged.seriesId).not.toBe(first.seriesId);
    expect(resourceChanged.seriesId).not.toBe(first.seriesId);
    expect(tenantChanged.seriesId).not.toBe(first.seriesId);
  });

  it("recursively redacts nested AnyValue strings without flattening their types", async () => {
    const redactionService = {
      redactMetricAttributes: async (metric: {
        attributes: Record<string, string>;
      }) => {
        for (const key of Object.keys(metric.attributes)) {
          if (metric.attributes[key] === "secret") {
            metric.attributes[key] = "[REDACTED]";
          }
        }
      },
    };
    const result = await prepareMetricDataPoints({
      tenantId: "project-1",
      organizationId: "organization-1",
      request: requestForMetric({
        name: "nested",
        gauge: {
          dataPoints: [
            {
              timeUnixNano: "1700000000000000000",
              asDouble: 1,
              attributes: [
                {
                  key: "nested",
                  value: {
                    kvlistValue: {
                      values: [
                        {
                          key: "array",
                          value: {
                            arrayValue: {
                              values: [
                                { stringValue: "secret" },
                                { intValue: "7" },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      }) as never,
      piiRedactionLevel: "STRICT",
      redactionService,
      acceptedAt: 1_800_000_000_000,
    });

    const point = result.accepted[0]!.dataPoint;
    expect(point.canonicalPayload).not.toContain("secret");
    expect(point.canonicalPayload).toContain("[REDACTED]");
    expect(point.pointAttributesJson).toContain('"type":"int","value":"7"');
  });

  it("isolates non-idempotent resource redaction across sibling points", async () => {
    const redactionService = {
      redactMetricAttributes: async (metric: {
        attributes: Record<string, string>;
      }) => {
        for (const key of Object.keys(metric.attributes)) {
          metric.attributes[key] = `${metric.attributes[key]}-redacted`;
        }
      },
    };
    const result = await prepareMetricDataPoints({
      tenantId: "project-1",
      organizationId: "organization-1",
      request: requestForMetric(
        {
          name: "siblings",
          gauge: {
            dataPoints: [
              { timeUnixNano: "1700000000000000000", asDouble: 1 },
              { timeUnixNano: "1700000001000000000", asDouble: 2 },
            ],
          },
        },
        {
          resourceAttributes: [
            { key: "service.name", value: { stringValue: "api" } },
          ],
        },
      ) as never,
      piiRedactionLevel: "STRICT",
      redactionService,
      acceptedAt: 1_800_000_000_000,
    });

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0]!.dataPoint.seriesId).toBe(
      result.accepted[1]!.dataPoint.seriesId,
    );
    expect(result.accepted[0]!.dataPoint.resourceAttributesJson).toContain(
      "api-redacted",
    );
    expect(result.accepted[1]!.dataPoint.resourceAttributesJson).not.toContain(
      "api-redacted-redacted",
    );
  });

  it("rejects a malformed point without dropping its valid sibling", async () => {
    const result = await prepare(
      requestForMetric({
        name: "partial.metric",
        gauge: {
          dataPoints: [
            { asDouble: 1 },
            {
              timeUnixNano: "1700000000000000000",
              asDouble: 2,
            },
          ],
        },
      }),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejectedDataPoints).toBe(1);
    expect(result.errors[0]).toContain("missing timeUnixNano");
  });

  it("rejects inconsistent histogram buckets before enqueueing", async () => {
    const result = await prepare(
      requestForMetric({
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
      }),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejectedDataPoints).toBe(1);
    expect(result.errors[0]).toContain("must sum to count");
  });
});

describe("metric command lanes", () => {
  it("clamps configuration to 1-128 and always returns a bounded non-empty lane", () => {
    expect(resolveMetricCommandShardCount("0")).toBe(1);
    expect(resolveMetricCommandShardCount("1000")).toBe(128);
    expect(resolveMetricCommandShardCount("bad")).toBe(16);
    const pointId = "a".repeat(64);
    expect(metricCommandGroupKey(pointId, 16)).toMatch(
      /^metric:(?:[0-9]|1[0-5])$/,
    );
    expect(metricCommandGroupKey(pointId, 16)).toBe(
      metricCommandGroupKey(pointId, 16),
    );
  });

  it("installs bounded lane routing on the real command registration", () => {
    const store = {} as never;
    const pipeline = createMetricProcessingPipeline({
      metricDataPointAppendStore: store,
      metricSeriesCatalogAppendStore: store,
      metricTimeRollupAppendStore: store,
      metricCommandShardCount: 8,
    });
    const command = pipeline.commands.find(
      (candidate) => candidate.name === "recordDataPoint",
    );
    const getGroupKey = command?.options?.getGroupKey;
    expect(getGroupKey).toBeDefined();

    const groups = new Set(
      Array.from({ length: 64 }, (_, index) =>
        getGroupKey!({
          pointId: index.toString(16).padStart(64, "0"),
        } as never),
      ),
    );
    expect(groups.size).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group).toMatch(/^metric:[0-7]$/);
    }
  });
});
