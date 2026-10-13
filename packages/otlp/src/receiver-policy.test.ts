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

    applyOtlpReceiverPolicy({
      request,
      signal: "traces",
      apiKeyId: "authenticated",
      policy: {
        resourceAttributeKeysToRemove: ["remove"],
        resourceAttributes: [
          attribute("configured", "yes"),
          attribute("langwatch.api_key.id", "policy"),
        ],
        allowedTraceScopeNames: ["allowed"],
      },
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

  /** @scenario "Metrics cannot hide keys in points or exemplars" */
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

    const result = applyOtlpReceiverPolicy({
      request,
      signal: "metrics",
      apiKeyId: null,
      policy: {
        resourceAttributeKeysToRemove: [],
        resourceAttributes: [],
        allowedMetricScopeNames: ["keep"],
      },
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

    applyOtlpReceiverPolicy({
      request,
      signal: "logs",
      apiKeyId: null,
      policy: {
        resourceAttributeKeysToRemove: [],
        resourceAttributes: [],
      },
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

    expect(
      applyOtlpReceiverPolicy({ request: traces, signal: "traces", apiKeyId: null, policy }),
    ).toEqual({ droppedScopes: 1 });
    expect(
      applyOtlpReceiverPolicy({ request: metrics, signal: "metrics", apiKeyId: null, policy }),
    ).toEqual({ droppedScopes: 1 });
    expect(traces.resourceSpans).toEqual([]);
    expect(metrics.resourceMetrics).toEqual([]);
  });

  it("accepts the transformer request types without conversion", () => {
    const trace: IExportTraceServiceRequest = { resourceSpans: [] };
    const metric: IExportMetricsServiceRequest = { resourceMetrics: [] };
    const logs: IExportLogsServiceRequest = { resourceLogs: [] };
    applyOtlpReceiverPolicy({ request: trace, signal: "traces", apiKeyId: null });
    applyOtlpReceiverPolicy({ request: metric, signal: "metrics", apiKeyId: null });
    applyOtlpReceiverPolicy({ request: logs, signal: "logs", apiKeyId: null });
    expect(trace.resourceSpans).toEqual([]);
    expect(metric.resourceMetrics).toEqual([]);
    expect(logs.resourceLogs).toEqual([]);
  });

  /** @scenario "A credential without an API key row leaves no key attribute" */
  /** @scenario "Receiver protection preserves future wire fields" */
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

    applyOtlpReceiverPolicy({ request, signal: "traces", apiKeyId: null });

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

  /** @scenario "Metrics cannot hide keys in points or exemplars" */
  /** @scenario "Receiver protection preserves future wire fields" */
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

      applyOtlpReceiverPolicy({ request, signal: "metrics", apiKeyId: "real" });

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

    const result = applyOtlpReceiverPolicy({
      request,
      signal: "traces",
      apiKeyId: null,
      policy: {
        resourceAttributeKeysToRemove: [],
        resourceAttributes: [],
        allowedTraceScopeNames: [],
      },
    });

    expect(result).toEqual({ droppedScopes: 1 });
    expect(request.resourceSpans).toEqual([]);
  });

  /** @scenario "Receiver identity wins over sender and configured policy" */
  it.each(["traces", "logs", "metrics"] as const)(
    "leaves one authenticated key attribute on every %s resource and none nested",
    (signal) => {
      const forged = () => [attribute("langwatch.api_key.id", "forged"), attribute("kept")];
      const resourceKey = {
        traces: "resourceSpans",
        logs: "resourceLogs",
        metrics: "resourceMetrics",
      }[signal];
      const scopeKey = { traces: "scopeSpans", logs: "scopeLogs", metrics: "scopeMetrics" }[signal];
      const contents = {
        traces: { spans: [{ attributes: forged(), events: [{ attributes: forged() }] }] },
        logs: { logRecords: [{ attributes: forged() }] },
        metrics: {
          metrics: [{ attributes: forged(), gauge: { dataPoints: [{ attributes: forged() }] } }],
        },
      }[signal];
      const resources = [
        {
          resource: { attributes: forged() },
          [scopeKey]: [{ scope: { attributes: forged() }, ...contents }],
        },
        { [scopeKey]: [] },
      ];
      const request = { [resourceKey]: resources };

      applyOtlpReceiverPolicy({
        request,
        signal,
        apiKeyId: "key_real",
        policy: {
          resourceAttributeKeysToRemove: ["langwatch.api_key.id"],
          resourceAttributes: [attribute("langwatch.api_key.id", "policy")],
        },
      });

      const forgedAnywhere = JSON.stringify(request).match(/"forged"|"policy"/g);
      expect(forgedAnywhere).toBeNull();
      for (const group of resources) {
        const keys = (group.resource?.attributes ?? []).filter(
          (candidate) => candidate.key === "langwatch.api_key.id",
        );
        expect(keys).toEqual([attribute("langwatch.api_key.id", "key_real")]);
      }
      expect(JSON.stringify(request).match(/langwatch\.api_key\.id/g)).toHaveLength(
        resources.length,
      );
    },
  );
});
