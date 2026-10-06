import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
  ILogRecord,
  IMetric,
  INumberDataPoint,
  ISpan,
} from "@opentelemetry/otlp-transformer";
import { describe, expect, it } from "vitest";

import {
  buildWebhookLogRequest,
  countLogRecords,
  countMetricDataPoints,
  countSpans,
  hasMetricPayload,
  stampLogOriginAttrs,
  stampMetricOriginAttrs,
  stampOriginAttrs,
} from "../governance-ingest-payload.rules.ts";

const source = {
  id: "src_1",
  organizationId: "org_1",
  sourceType: "otel_generic",
} as GovernanceIngestionSource;

const ORIGIN = [
  { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
  { key: "langwatch.ingestion_source.id", value: { stringValue: "src_1" } },
  { key: "langwatch.ingestion_source.organization_id", value: { stringValue: "org_1" } },
  { key: "langwatch.ingestion_source.source_type", value: { stringValue: "otel_generic" } },
];

function span(attributes: IKeyValue[] = []): ISpan {
  return {
    traceId: "",
    spanId: "",
    name: "span",
    kind: 1,
    startTimeUnixNano: "0",
    endTimeUnixNano: "0",
    attributes,
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: { code: 0 },
  };
}

function logRecord(attributes: IKeyValue[] = []): ILogRecord {
  return { timeUnixNano: "0", observedTimeUnixNano: "0", attributes, droppedAttributesCount: 0 };
}

const point: INumberDataPoint = { attributes: [], startTimeUnixNano: "0", timeUnixNano: "0" };

function metric(shape: Partial<IMetric>): IMetric {
  return { name: "metric", ...shape };
}

const forged: IKeyValue[] = [
  { key: "app.name", value: { stringValue: "kept" } },
  { key: "langwatch.origin.kind", value: { stringValue: "forged" } },
  { key: "langwatch.ingestion_source.id", value: { stringValue: "someone_else" } },
];

describe("buildWebhookLogRequest()", () => {
  it("maps the envelope onto exactly one INFO log record carrying the origin", () => {
    const request = buildWebhookLogRequest({ rawBody: '{"a":1}', source, nowNanos: "1000" });

    expect(request).toEqual({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "ingestion-source/otel_generic" } },
            ],
            droppedAttributesCount: 0,
          },
          scopeLogs: [
            {
              scope: { name: "langwatch.governance.ingestion", version: "1" },
              logRecords: [
                {
                  timeUnixNano: "1000",
                  observedTimeUnixNano: "1000",
                  severityNumber: 9,
                  severityText: "INFO",
                  body: { stringValue: '{"a":1}' },
                  attributes: ORIGIN,
                  droppedAttributesCount: 0,
                  traceId: new Uint8Array(0),
                  spanId: new Uint8Array(0),
                  flags: 0,
                },
              ],
              schemaUrl: "",
            },
          ],
          schemaUrl: "",
        },
      ],
    });
  });
});

describe("origin stamping", () => {
  describe("when a payload supplies its own reserved origin keys", () => {
    it("replaces them on spans and keeps the caller's other attributes", () => {
      const request: IExportTraceServiceRequest = {
        resourceSpans: [{ scopeSpans: [{ spans: [span([...forged])] }] }],
      };

      stampOriginAttrs(request, source);

      expect(request.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.attributes).toEqual([
        forged[0],
        ...ORIGIN,
      ]);
    });

    it("replaces them on log records", () => {
      const request: IExportLogsServiceRequest = {
        resourceLogs: [{ scopeLogs: [{ logRecords: [logRecord([...forged])] }] }],
      };

      stampLogOriginAttrs(request, source);

      expect(request.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.attributes).toEqual([
        forged[0],
        ...ORIGIN,
      ]);
    });

    it("stamps a metric resource, creating one where the payload had none", () => {
      const request: IExportMetricsServiceRequest = {
        resourceMetrics: [
          { resource: { attributes: [...forged], droppedAttributesCount: 0 }, scopeMetrics: [] },
          { scopeMetrics: [] },
        ],
      };

      stampMetricOriginAttrs({ request, source });

      expect(request.resourceMetrics?.[0]?.resource?.attributes).toEqual([forged[0], ...ORIGIN]);
      expect(request.resourceMetrics?.[1]?.resource).toEqual({
        attributes: ORIGIN,
        droppedAttributesCount: 0,
      });
    });
  });
});

describe("counts", () => {
  it("counts spans and log records across resources and scopes", () => {
    const traces: IExportTraceServiceRequest = {
      resourceSpans: [
        { scopeSpans: [{ spans: [span(), span()] }, {}] },
        { scopeSpans: [{ spans: [span()] }] },
      ],
    };
    const logs: IExportLogsServiceRequest = {
      resourceLogs: [
        { scopeLogs: [{ logRecords: [logRecord()] }, { logRecords: [logRecord(), logRecord()] }] },
        { scopeLogs: [] },
      ],
    };

    expect(countSpans(traces)).toBe(3);
    expect(countLogRecords(logs)).toBe(3);
  });

  it("counts data points across all five point shapes", () => {
    const timing = { attributes: [], startTimeUnixNano: "0", timeUnixNano: "0" };
    const request: IExportMetricsServiceRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                metric({ gauge: { dataPoints: [point] } }),
                metric({
                  sum: { dataPoints: [point, point], aggregationTemporality: 1, isMonotonic: true },
                }),
                metric({
                  histogram: {
                    dataPoints: [{ ...timing, count: 1, bucketCounts: [], explicitBounds: [] }],
                    aggregationTemporality: 1,
                  },
                }),
                metric({
                  exponentialHistogram: {
                    dataPoints: [
                      {
                        ...timing,
                        count: 1,
                        scale: 0,
                        zeroCount: 0,
                        positive: { offset: 0, bucketCounts: [] },
                        negative: { offset: 0, bucketCounts: [] },
                        exemplars: [],
                      },
                    ],
                    aggregationTemporality: 1,
                  },
                }),
                metric({
                  summary: {
                    dataPoints: [
                      {
                        attributes: [],
                        startTimeUnixNano: 0,
                        timeUnixNano: "0",
                        count: 1,
                        sum: 0,
                        quantileValues: [],
                      },
                    ],
                  },
                }),
              ],
            },
          ],
        },
      ],
    };

    expect(countMetricDataPoints(request)).toBe(6);
  });

  describe("when the metrics carry malformed data points", () => {
    it("still reports a metric payload, so validation is not skipped", () => {
      // wrong-typed input: a sender's gauge with no dataPoints array at all
      const malformed = { name: "metric", gauge: {} } as unknown as IMetric;
      const request: IExportMetricsServiceRequest = {
        resourceMetrics: [{ scopeMetrics: [{ metrics: [malformed] }] }],
      };

      expect(countMetricDataPoints(request)).toBe(0);
      expect(hasMetricPayload(request)).toBe(true);
      expect(hasMetricPayload({ resourceMetrics: [] })).toBe(false);
    });
  });
});
