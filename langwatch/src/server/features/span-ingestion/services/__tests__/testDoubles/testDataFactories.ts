import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { TraceForCollection } from "../../../../tracer/otel.traces";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { SpanKind } from "@opentelemetry/api";

export function createMockReadableSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  // Extract spanContext overrides before spreading
  const { spanContext: spanContextOverrides, ...otherOverrides } = overrides;

  const mockSpanContext = {
    traceId: spanContextOverrides?.traceId || "test-trace-id",
    spanId: spanContextOverrides?.spanId || "test-span-id",
    traceFlags: spanContextOverrides?.traceFlags || 1,
    isRemote: spanContextOverrides?.isRemote || false,
  };

  const readableSpan = {
    name: otherOverrides.name || "test-span",
    kind: otherOverrides.kind || SpanKind.INTERNAL,
    spanContext: () => mockSpanContext,
    parentSpanId: otherOverrides.parentSpanId || null,
    startTime: otherOverrides.startTime || [1000000, 0],
    endTime: otherOverrides.endTime || [2000000, 0],
    attributes: otherOverrides.attributes || {},
    links: otherOverrides.links || [],
    events: otherOverrides.events || [],
    status: otherOverrides.status || { code: 0 },
    instrumentationLibrary: otherOverrides.instrumentationLibrary || {
      name: "test-library",
      version: "1.0.0",
    },
    resource: otherOverrides.resource || {
      attributes: { "service.name": "test-service" },
    },
    ...otherOverrides,
  } as ReadableSpan;

  return readableSpan;
}

export function createMockTraceForCollection(overrides: Partial<TraceForCollection> = {}): TraceForCollection {
  return {
    traceId: overrides.traceId || "test-trace-id",
    spans: overrides.spans || [
      {
        id: "test-span-id",
        name: "test-span",
        kind: SpanKind.INTERNAL,
        traceId: "test-trace-id",
        parentSpanId: null,
        startTime: 1000000,
        endTime: 2000000,
        attributes: {},
        events: [],
        status: { code: 0 },
        resource: { attributes: { "service.name": "test-service" } },
        instrumentationScope: {
          name: "test-library",
          version: "1.0.0",
        },
      },
    ],
    ...overrides,
  };
}

export function createMockExportTraceServiceRequest(overrides: Partial<IExportTraceServiceRequest> = {}): IExportTraceServiceRequest {
  return {
    resourceSpans: overrides.resourceSpans || [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "test-service" } }],
        },
        scopeSpans: [
          {
            scope: {
              name: "test-library",
              version: "1.0.0",
            },
            spans: [
              {
                traceId: "test-trace-id",
                spanId: "test-span-id",
                name: "test-span",
                kind: 1,
                startTimeUnixNano: "1000000",
                endTimeUnixNano: "2000000",
                attributes: [],
                events: [],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}
