import { describe, expect, it, vi } from "vitest";
import type { CanonicalMetricDataPoint } from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import type { RecordMetricCorrelationCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { MetricRequestCollectionService } from "../metric-request-collection.service";

function makeService() {
  const recordDataPoint = vi.fn<
    (data: CanonicalMetricDataPoint) => Promise<void>
  >(async () => {});
  const recordMetricCorrelation = vi.fn<
    (data: RecordMetricCorrelationCommandData) => Promise<void>
  >(async () => {});
  const piiRedactionService = {
    redactMetricAttributes: async () => {},
  };
  const service = new MetricRequestCollectionService({
    recordDataPoint,
    recordMetricCorrelation,
    piiRedactionService,
  });
  return { service, recordDataPoint, recordMetricCorrelation };
}

function gaugeRequest(args: {
  value?: number;
  resourceAttributes?: Array<Record<string, unknown>>;
  pointAttributes?: Array<Record<string, unknown>>;
}) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: args.resourceAttributes ?? [] },
        scopeMetrics: [
          {
            scope: { name: "test", version: "1.0.0" },
            metrics: [
              {
                name: "requests.active",
                unit: "{request}",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: "1700000000000000000",
                      asInt: args.value ?? 1,
                      attributes: args.pointAttributes ?? [],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const requestContext = {
  tenantId: "project_test_tenant",
  organizationId: "organization_test",
  piiRedactionLevel: "DISABLED",
} as const;

describe("MetricRequestCollectionService", () => {
  it("keeps a standalone gauge as one canonical integer data point", async () => {
    const { service, recordDataPoint, recordMetricCorrelation } = makeService();

    const result = await service.handleOtlpMetricRequest({
      ...requestContext,
      metricRequest: gaugeRequest({ value: 42 }),
    });

    expect(result).toEqual({ acceptedDataPoints: 1, rejectedDataPoints: 0 });
    expect(recordDataPoint).toHaveBeenCalledTimes(1);
    expect(recordDataPoint.mock.calls[0]![0]).toMatchObject({
      tenantId: requestContext.tenantId,
      organizationId: requestContext.organizationId,
      metricName: "requests.active",
      metricKind: "gauge",
      valueType: "int",
      valueInt: "42",
      timeUnixNano: "1700000000000000000",
    });
    expect(recordMetricCorrelation).not.toHaveBeenCalled();
  });

  it("makes identity independent of attribute order and acceptance time", async () => {
    const { service, recordDataPoint } = makeService();
    const a = { key: "a", value: { stringValue: "one" } };
    const b = { key: "b", value: { intValue: "2" } };

    await service.handleOtlpMetricRequest({
      ...requestContext,
      metricRequest: gaugeRequest({ pointAttributes: [a, b] }),
    });
    await service.handleOtlpMetricRequest({
      ...requestContext,
      metricRequest: gaugeRequest({ pointAttributes: [b, a] }),
    });
    await service.handleOtlpMetricRequest({
      ...requestContext,
      metricRequest: gaugeRequest({ value: 2, pointAttributes: [a, b] }),
    });

    const first = recordDataPoint.mock.calls[0]![0];
    const retry = recordDataPoint.mock.calls[1]![0];
    const changedValue = recordDataPoint.mock.calls[2]![0];
    expect(retry.seriesId).toBe(first.seriesId);
    expect(retry.pointId).toBe(first.pointId);
    expect(changedValue.seriesId).toBe(first.seriesId);
    expect(changedValue.pointId).not.toBe(first.pointId);
  });

  it("rejects an oversized sibling while accepting and correlating a valid point", async () => {
    const { service, recordDataPoint, recordMetricCorrelation } = makeService();
    const traceId = "0123456789abcdef0123456789abcdef";
    const spanId = "0123456789abcdef";

    const result = await service.handleOtlpMetricRequest({
      ...requestContext,
      metricRequest: {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                scope: { name: "test" },
                metrics: [
                  {
                    name: "payload.size",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 1,
                          attributes: [
                            {
                              key: "oversized",
                              value: { stringValue: "x".repeat(270_000) },
                            },
                          ],
                        },
                        {
                          timeUnixNano: "1700000030000000000",
                          asDouble: 2.5,
                          exemplars: [
                            {
                              timeUnixNano: "1700000030000000000",
                              asDouble: 2.5,
                              traceId: Buffer.from(traceId, "hex").toString(
                                "base64",
                              ),
                              spanId: Buffer.from(spanId, "hex").toString(
                                "base64",
                              ),
                            },
                            {
                              timeUnixNano: "1700000030000000001",
                              asDouble: 3,
                              traceId: Buffer.from(traceId, "hex").toString(
                                "base64",
                              ),
                              spanId: Buffer.from(spanId, "hex").toString(
                                "base64",
                              ),
                            },
                            {
                              timeUnixNano: "1700000030000000002",
                              asDouble: 4,
                              traceId: "not-a-trace-id",
                              spanId: "not-a-span-id",
                            },
                          ],
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

    expect(result.acceptedDataPoints).toBe(1);
    expect(result.rejectedDataPoints).toBe(1);
    expect(result.errorMessage).toContain("maximum 262144");
    expect(recordDataPoint).toHaveBeenCalledTimes(1);
    expect(recordMetricCorrelation).toHaveBeenCalledTimes(1);
    expect(recordMetricCorrelation.mock.calls[0]![0]).toMatchObject({
      traceId,
      spanId,
      exemplarValue: 2.5,
    });
  });
});
