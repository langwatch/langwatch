import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import { describe, expect, it } from "vitest";

import { applyOtlpReceiverPolicy } from "./receiver-policy.ts";

const attribute = (key: string, value: string | null = key) => ({
  key,
  value: { stringValue: value },
});

describe("applyOtlpReceiverPolicy", () => {
  it("scrubs forged identity attributes from every trace location and stamps the resource", () => {
    const event = { attributes: [attribute("langwatch.api_key.id"), attribute("event")] };
    const link = { attributes: [attribute("langwatch.api_key.id"), attribute("link")] };
    const span = {
      attributes: [attribute("langwatch.api_key.id"), attribute("span")],
      events: [event],
      links: [link],
    };
    const request = {
      resourceSpans: [
        {
          resource: {
            attributes: [attribute("langwatch.api_key.id", "forged"), attribute("remove")],
          },
          scopeSpans: [
            {
              scope: { name: "allowed", attributes: [attribute("langwatch.api_key.id")] },
              spans: [span],
            },
          ],
        },
      ],
    };

    applyOtlpReceiverPolicy(request, "traces", "authenticated", {
      resourceAttributeKeysToRemove: ["remove"],
      resourceAttributes: [
        attribute("configured", "yes"),
        attribute("langwatch.api_key.id", "policy"),
      ],
      allowedTraceScopeNames: ["allowed"],
    });

    expect(request.resourceSpans?.[0]?.resource?.attributes).toEqual([
      attribute("configured", "yes"),
      attribute("langwatch.api_key.id", "authenticated"),
    ]);
    expect(request.resourceSpans?.[0]?.scopeSpans?.[0]?.scope?.attributes).toEqual([]);
    expect(span.attributes).toEqual([attribute("span")]);
    expect(event.attributes).toEqual([attribute("event")]);
    expect(link.attributes).toEqual([attribute("link")]);
  });

  it("filters metric scopes and scrubs data point and exemplar attributes", () => {
    const request = {
      resourceMetrics: [
        {
          scopeMetrics: [
            { scope: { name: "drop" }, metrics: [] },
            {
              scope: { name: "keep" },
              metrics: [
                {
                  gauge: {
                    dataPoints: [
                      {
                        attributes: [attribute("langwatch.api_key.id"), attribute("ok")],
                        exemplars: [
                          {
                            filteredAttributes: [
                              attribute("langwatch.api_key.id"),
                              attribute("exemplar"),
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  attributes: [attribute("langwatch.api_key.id"), attribute("metric")],
                  summary: { dataPoints: [{ attributes: [attribute("langwatch.api_key.id")] }] },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = applyOtlpReceiverPolicy(request, "metrics", null, {
      resourceAttributeKeysToRemove: [],
      resourceAttributes: [],
      allowedMetricScopeNames: ["keep"],
    });

    expect(result).toEqual({ droppedScopes: 1 });
    expect(request.resourceMetrics).toHaveLength(1);
    expect(request.resourceMetrics?.[0]?.scopeMetrics).toHaveLength(1);
    const metric = request.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0];
    expect(metric?.attributes).toEqual([attribute("metric")]);
    expect(metric?.gauge?.dataPoints?.[0]?.attributes).toEqual([attribute("ok")]);
    expect(metric?.gauge?.dataPoints?.[0]?.exemplars?.[0]?.filteredAttributes).toEqual([
      attribute("exemplar"),
    ]);
    expect(metric?.summary?.dataPoints?.[0]?.attributes).toEqual([]);
  });

  it("keeps logs and missing or null arrays while scrubbing log attributes", () => {
    const request = {
      resourceLogs: [
        {
          resource: null,
          scopeLogs: [
            {
              scope: null,
              logRecords: [
                { attributes: null },
                { attributes: [attribute("langwatch.api_key.id")] },
              ],
            },
          ],
        },
      ],
    };

    applyOtlpReceiverPolicy(request, "logs", null, {
      resourceAttributeKeysToRemove: [],
      resourceAttributes: [],
    });

    expect(request.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.attributes).toBeNull();
    expect(request.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[1]?.attributes).toEqual([]);
    expect(request.resourceLogs?.[0]?.resource).toEqual({
      attributes: [],
    });
  });

  it("drops trace and metric resources with no allowed scopes, including null and empty scope arrays", () => {
    const traces = {
      resourceSpans: [
        { scopeSpans: null },
        { scopeSpans: [] },
        { scopeSpans: [{ scope: null, spans: [] }] },
      ],
    };
    const metrics = {
      resourceMetrics: [
        { scopeMetrics: null },
        { scopeMetrics: [] },
        { scopeMetrics: [{ scope: { name: "blocked" }, metrics: [] }] },
      ],
    };
    const policy = {
      resourceAttributeKeysToRemove: [],
      resourceAttributes: [],
      allowedTraceScopeNames: ["allowed"],
      allowedMetricScopeNames: ["allowed"],
    };

    expect(applyOtlpReceiverPolicy(traces, "traces", null, policy)).toEqual({ droppedScopes: 1 });
    expect(applyOtlpReceiverPolicy(metrics, "metrics", null, policy)).toEqual({ droppedScopes: 1 });
    expect(traces.resourceSpans).toEqual([]);
    expect(metrics.resourceMetrics).toEqual([]);
  });

  it("accepts the transformer request types without conversion", () => {
    const trace: IExportTraceServiceRequest = { resourceSpans: [] };
    const metric: IExportMetricsServiceRequest = { resourceMetrics: [] };
    const logs: IExportLogsServiceRequest = { resourceLogs: [] };
    applyOtlpReceiverPolicy(trace, "traces", null);
    applyOtlpReceiverPolicy(metric, "metrics", null);
    applyOtlpReceiverPolicy(logs, "logs", null);
    expect(trace.resourceSpans).toEqual([]);
    expect(metric.resourceMetrics).toEqual([]);
    expect(logs.resourceLogs).toEqual([]);
  });

  it("preserves wire fields while removing duplicate and nested forged identities", () => {
    const span = {
      traceId: "trace-original",
      startTimeUnixNano: "1720000000000000000",
      futureField: { value: 42 },
      attributes: [attribute("langwatch.api_key.id"), attribute("span")],
    };
    const scope = {
      name: "custom",
      version: "2.0",
      droppedAttributesCount: 3,
      attributes: [attribute("langwatch.api_key.id")],
    };
    const resource = {
      droppedAttributesCount: 7,
      futureResourceField: "kept",
      attributes: [
        attribute("langwatch.api_key.id", "first"),
        attribute("langwatch.api_key.id", "second"),
        attribute("service.name", "customer"),
      ],
    };
    const request = { resourceSpans: [{ resource, scopeSpans: [{ scope, spans: [span] }] }] };

    applyOtlpReceiverPolicy(request, "traces", null);

    expect(resource).toEqual({
      droppedAttributesCount: 7,
      futureResourceField: "kept",
      attributes: [attribute("service.name", "customer")],
    });
    expect(scope).toEqual({
      name: "custom",
      version: "2.0",
      droppedAttributesCount: 3,
      attributes: [],
    });
    expect(span).toEqual({
      traceId: "trace-original",
      startTimeUnixNano: "1720000000000000000",
      futureField: { value: 42 },
      attributes: [attribute("span")],
    });
  });

  it.each(["gauge", "sum", "histogram", "exponentialHistogram", "summary"] as const)(
    "protects attributes in %s without changing metric values",
    (kind) => {
      const point = {
        asDouble: 42,
        timeUnixNano: "1720000000000000000",
        attributes: [attribute("langwatch.api_key.id"), attribute("point")],
        exemplars: [{ filteredAttributes: [attribute("langwatch.api_key.id")] }],
      };
      const metric = { [kind]: { dataPoints: [point] }, attributes: [] };
      const request = { resourceMetrics: [{ scopeMetrics: [{ metrics: [metric] }] }] };

      applyOtlpReceiverPolicy(request, "metrics", "real");

      expect(point).toEqual({
        asDouble: 42,
        timeUnixNano: "1720000000000000000",
        attributes: [attribute("point")],
        exemplars: [{ filteredAttributes: [] }],
      });
    },
  );

  it("removes null scopes and their empty resources under a scope restriction", () => {
    const request = { resourceSpans: [{ scopeSpans: [null] }] };

    const result = applyOtlpReceiverPolicy(request, "traces", null, {
      resourceAttributeKeysToRemove: [],
      resourceAttributes: [],
      allowedTraceScopeNames: [],
    });

    expect(result).toEqual({ droppedScopes: 1 });
    expect(request.resourceSpans).toEqual([]);
  });
});
