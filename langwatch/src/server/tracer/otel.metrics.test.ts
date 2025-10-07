import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { assert, describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import type { DeepPartial } from "../../utils/types";
import { openTelemetryMetricsRequestToTracesForCollection } from "./otel.metrics";
import { spanSchema } from "./types.generated";

const timeToFirstTokenMetricsRequest: DeepPartial<IExportMetricsServiceRequest> =
  {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: "telemetry.sdk.language",
              value: {
                stringValue: "python",
              },
            },
            {
              key: "telemetry.sdk.name",
              value: {
                stringValue: "opentelemetry",
              },
            },
            {
              key: "telemetry.sdk.version",
              value: {
                stringValue: "1.36.0",
              },
            },
            {
              key: "service.name",
              value: {
                stringValue: "my-agent",
              },
            },
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: "gen_ai.server",
            },
            metrics: [
              {
                name: "gen_ai.server.time_to_first_token",
                description:
                  "Time to generate first token for successful responses",
                unit: "s",
                histogram: {
                  dataPoints: [
                    {
                      startTimeUnixNano: "1759757017682048000",
                      timeUnixNano: "1759757033052292000",
                      count: 1,
                      sum: 2.7979350090026855,
                      bucketCounts: [
                        0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                      ],
                      explicitBounds: [
                        0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500,
                        5000, 7500, 10000,
                      ],
                      exemplars: [
                        {
                          timeUnixNano: "1759757017681929000",
                          asDouble: 2.7979350090026855,
                          spanId: "I9f0+HNXuqs=",
                          traceId: "lW9EqTIEUX6EAJ8GxleP8w==",
                        },
                      ],
                      attributes: [
                        {
                          key: "model",
                          value: {
                            stringValue: "gpt-5",
                          },
                        },
                        {
                          key: "request.status",
                          value: {
                            stringValue: "success",
                          },
                        },
                      ],
                      min: 2.7979350090026855,
                      max: 2.7979350090026855,
                    },
                  ],
                  aggregationTemporality: 1,
                },
              },
            ],
          },
        ],
      },
    ],
  };

const multipleExemplarsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "test-service",
            },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: {
            name: "gen_ai.server",
          },
          metrics: [
            {
              name: "gen_ai.server.time_to_first_token",
              unit: "s",
              histogram: {
                dataPoints: [
                  {
                    timeUnixNano: "1759757033052292000",
                    exemplars: [
                      {
                        timeUnixNano: "1759757017681929000",
                        asDouble: 1.5,
                        spanId: "c3BhbjExMTExMTExMTE=",
                        traceId: "dHJhY2UxMTExMTExMTE=",
                      },
                      {
                        timeUnixNano: "1759757020000000000",
                        asDouble: 2.3,
                        spanId: "c3BhbjIyMjIyMjIyMjI=",
                        traceId: "dHJhY2UxMTExMTExMTE=",
                      },
                    ],
                    attributes: [],
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

const gaugeMetricsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "gauge-service",
            },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: {
            name: "gen_ai.server",
          },
          metrics: [
            {
              name: "gen_ai.server.active_requests",
              unit: "count",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1759757033052292000",
                    asInt: 5,
                    exemplars: [
                      {
                        timeUnixNano: "1759757017681929000",
                        asInt: 5,
                        spanId: "Z2F1Z2VzcGFuaWQxMg==",
                        traceId: "Z2F1Z2V0cmFjZWlkMQ==",
                      },
                    ],
                    attributes: [
                      {
                        key: "endpoint",
                        value: {
                          stringValue: "/api/chat",
                        },
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
};

const sumMetricsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "sum-service",
            },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: {
            name: "gen_ai.server",
          },
          metrics: [
            {
              name: "gen_ai.server.request.duration",
              unit: "s",
              sum: {
                dataPoints: [
                  {
                    timeUnixNano: "1759757033052292000",
                    asDouble: 12.5,
                    exemplars: [
                      {
                        timeUnixNano: "1759757017681929000",
                        asDouble: 12.5,
                        spanId: "c3Vtc3BhbmlkMTIzNDU=",
                        traceId: "c3VtdHJhY2VpZDEyMzQ=",
                      },
                    ],
                    attributes: [
                      {
                        key: "model",
                        value: {
                          stringValue: "gpt-4",
                        },
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
};

const emptyMetricsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [],
};

const noExemplarsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [],
      },
      scopeMetrics: [
        {
          scope: {
            name: "gen_ai.server",
          },
          metrics: [
            {
              name: "gen_ai.server.time_to_first_token",
              unit: "s",
              histogram: {
                dataPoints: [
                  {
                    timeUnixNano: "1759757033052292000",
                    count: 10,
                    sum: 25.5,
                    // No exemplars
                    attributes: [],
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

const missingIdsRequest: DeepPartial<IExportMetricsServiceRequest> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [],
      },
      scopeMetrics: [
        {
          scope: {
            name: "gen_ai.server",
          },
          metrics: [
            {
              name: "gen_ai.server.time_to_first_token",
              unit: "s",
              histogram: {
                dataPoints: [
                  {
                    timeUnixNano: "1759757033052292000",
                    exemplars: [
                      {
                        timeUnixNano: "1759757017681929000",
                        asDouble: 1.5,
                        // Missing spanId and traceId
                      },
                    ],
                    attributes: [],
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

const multipleDifferentTracesRequest: DeepPartial<IExportMetricsServiceRequest> =
  {
    resourceMetrics: [
      {
        resource: {
          attributes: [],
        },
        scopeMetrics: [
          {
            scope: {
              name: "gen_ai.server",
            },
            metrics: [
              {
                name: "gen_ai.server.time_to_first_token",
                unit: "s",
                histogram: {
                  dataPoints: [
                    {
                      timeUnixNano: "1759757033052292000",
                      exemplars: [
                        {
                          timeUnixNano: "1759757017681929000",
                          asDouble: 1.5,
                          spanId: "c3BhbjExMTExMTExMTE=",
                          traceId: "dHJhY2VhYWFhYWFhYWE=",
                        },
                        {
                          timeUnixNano: "1759757020000000000",
                          asDouble: 2.3,
                          spanId: "c3BhbjIyMjIyMjIyMjI=",
                          traceId: "dHJhY2ViYmJiYmJiYmI=",
                        },
                      ],
                      attributes: [],
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

describe("opentelemetry metrics receiver", () => {
  it("receives time_to_first_token metric and maps to span timestamps", async () => {
    const traces = await openTelemetryMetricsRequestToTracesForCollection(
      timeToFirstTokenMetricsRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace!.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    const expectedTraceId = "956f44a93204517e84009f06c6578ff3";
    const expectedSpanId = "23d7f4f87357baab"; // Decoded from "I9f0+HNXuqs="

    expect(trace?.traceId).toEqual(expectedTraceId);
    expect(trace?.spans).toHaveLength(1);
    expect(trace?.spans[0]?.span_id).toEqual(expectedSpanId);
    expect(trace?.spans[0]?.trace_id).toEqual(expectedTraceId);
    expect(trace?.spans[0]?.type).toEqual("llm");
    expect(trace?.spans[0]?.timestamps?.first_token_at).toEqual(1759757017682);
    expect(
      trace?.spans[0]?.params?.metrics?.gen_ai?.server?.time_to_first_token
    ).toEqual({
      model: "gpt-5",
      request: {
        status: "success",
      },
      value: 2.7979350090026855,
      unit: "s",
      timestamp: 1759757017682,
    });
  });

  it("handles multiple exemplars in the same trace", async () => {
    const traces = await openTelemetryMetricsRequestToTracesForCollection(
      multipleExemplarsRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];
    if (!trace) {
      assert.fail("No trace found");
    }

    try {
      z.array(spanSchema).parse(trace.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace.spans).toHaveLength(2);

    // "c3BhbjExMTExMTExMTE=" -> "span1111111111" -> hex: 7370616e31313131313131313131
    const span1 = trace.spans.find(
      (s) => s.span_id === "7370616e31313131313131313131"
    );
    expect(span1).toBeDefined();
    expect(span1?.timestamps?.first_token_at).toEqual(1759757017682); // Rounded from 1759757017681.929

    // "c3BhbjIyMjIyMjIyMjI=" -> "span2222222222" -> hex: 7370616e32323232323232323232
    const span2 = trace.spans.find(
      (s) => s.span_id === "7370616e32323232323232323232"
    );
    expect(span2).toBeDefined();
    expect(span2?.timestamps?.first_token_at).toEqual(1759757020000);
  });

  it("handles multiple traces from different exemplars", async () => {
    const traces = await openTelemetryMetricsRequestToTracesForCollection(
      multipleDifferentTracesRequest
    );

    expect(traces).toHaveLength(2);

    try {
      for (const trace of traces) {
        z.array(spanSchema).parse(trace.spans);
      }
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("traces", JSON.stringify(traces, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    // "dHJhY2VhYWFhYWFhYWE=" -> "traceaaaaaaaaa" -> hex: 7472616365616161616161616161
    const trace1 = traces.find(
      (t) => t.traceId === "7472616365616161616161616161"
    );
    expect(trace1).toBeDefined();
    expect(trace1?.spans).toHaveLength(1);

    // "dHJhY2ViYmJiYmJiYmI=" -> "tracebbbbbbbbb" -> hex: 7472616365626262626262626262
    const trace2 = traces.find(
      (t) => t.traceId === "7472616365626262626262626262"
    );
    expect(trace2).toBeDefined();
    expect(trace2?.spans).toHaveLength(1);
  });

  it("handles gauge metrics with exemplars", async () => {
    const traces =
      await openTelemetryMetricsRequestToTracesForCollection(
        gaugeMetricsRequest
      );

    expect(traces).toHaveLength(1);

    const trace = traces[0];
    if (!trace) {
      assert.fail("No trace found");
    }

    try {
      z.array(spanSchema).parse(trace.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace.spans).toHaveLength(1);
    const span = trace.spans[0];
    expect(span?.params?.metrics).toBeDefined();
    // Check that the metric was stored
    const metrics = span?.params?.metrics;
    expect(metrics?.gen_ai?.server?.active_requests).toBeDefined();
    expect(metrics?.gen_ai?.server?.active_requests?.endpoint).toEqual(
      "/api/chat"
    );
    expect(metrics?.gen_ai?.server?.active_requests?.value).toEqual(5);
    expect(metrics?.gen_ai?.server?.active_requests?.unit).toEqual("count");
  });

  it("handles sum metrics with exemplars", async () => {
    const traces =
      await openTelemetryMetricsRequestToTracesForCollection(sumMetricsRequest);

    expect(traces).toHaveLength(1);

    const trace = traces[0];
    if (!trace) {
      assert.fail("No trace found");
    }

    try {
      z.array(spanSchema).parse(trace.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace.spans).toHaveLength(1);
    const span = trace.spans[0];
    expect(span?.params?.metrics).toBeDefined();
    const metrics = span?.params?.metrics;
    expect(metrics?.gen_ai?.server?.request?.duration).toBeDefined();
    expect(metrics?.gen_ai?.server?.request?.duration?.model).toEqual("gpt-4");
    expect(metrics?.gen_ai?.server?.request?.duration?.value).toEqual(12.5);
    expect(metrics?.gen_ai?.server?.request?.duration?.unit).toEqual("s");
  });

  it("handles empty metrics request", async () => {
    const traces =
      await openTelemetryMetricsRequestToTracesForCollection(
        emptyMetricsRequest
      );

    expect(traces).toHaveLength(0);
  });

  it("handles metrics without exemplars", async () => {
    const traces =
      await openTelemetryMetricsRequestToTracesForCollection(
        noExemplarsRequest
      );

    expect(traces).toHaveLength(0);
  });

  it("handles exemplars with missing trace or span IDs", async () => {
    const traces =
      await openTelemetryMetricsRequestToTracesForCollection(missingIdsRequest);

    expect(traces).toHaveLength(0);
  });

  it("validates all spans against schema", async () => {
    const allTestRequests = [
      timeToFirstTokenMetricsRequest,
      multipleExemplarsRequest,
      gaugeMetricsRequest,
      sumMetricsRequest,
      multipleDifferentTracesRequest,
    ];

    for (const request of allTestRequests) {
      const traces =
        await openTelemetryMetricsRequestToTracesForCollection(request);

      for (const trace of traces) {
        try {
          z.array(spanSchema).parse(trace.spans);
        } catch (error) {
          const validationError = fromZodError(error as ZodError);
          console.log("Failed request:", JSON.stringify(request, undefined, 2));
          console.log("trace", JSON.stringify(trace, undefined, 2));
          console.log("validationError", validationError);
          assert.fail(
            `Schema validation failed for trace ${trace.traceId}: ${validationError.message}`
          );
        }
      }
    }
  });
});
