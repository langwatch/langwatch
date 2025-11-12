import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanContext } from "@opentelemetry/api";
import type { TraceForCollection } from "../../../../../tracer/otel.traces";
import type { IExportTraceServiceRequest, IResourceSpans } from "@opentelemetry/otlp-transformer";
import { SpanKind } from "@opentelemetry/api";

type MockReadableSpanOverrides = Omit<Partial<ReadableSpan>, 'spanContext'> & {
  spanContext?: Partial<SpanContext>;
  parentSpanContext?: SpanContext;
  instrumentationScope?: { name: string; version: string; };
};

export function createMockReadableSpan(overrides: MockReadableSpanOverrides = {}): ReadableSpan {
  const { spanContext: spanContextOverrides, ...otherOverrides } = overrides;

  const mockSpanContext = {
    traceId: spanContextOverrides?.traceId ?? "test-trace-id",
    spanId: spanContextOverrides?.spanId ?? "test-span-id",
    traceFlags: spanContextOverrides?.traceFlags ?? 1,
    isRemote: spanContextOverrides?.isRemote ?? false,
  };

  const readableSpan = {
    name: otherOverrides.name ?? "test-span",
    kind: otherOverrides.kind ?? SpanKind.INTERNAL,
    spanContext: () => mockSpanContext,
    parentSpanContext: otherOverrides.parentSpanContext,
    startTime: otherOverrides.startTime ?? [1000000, 0],
    endTime: otherOverrides.endTime ?? [2000000, 0],
    attributes: otherOverrides.attributes ?? {},
    links: otherOverrides.links ?? [],
    events: otherOverrides.events ?? [],
    status: otherOverrides.status ?? { code: 0 },
    instrumentationScope: otherOverrides.instrumentationScope ?? {
      name: "test-library",
      version: "1.0.0",
    },
    resource: otherOverrides.resource ?? {
      attributes: { "service.name": "test-service" },
    },
    duration: otherOverrides.duration ?? [1000000, 0],
    ended: otherOverrides.ended ?? true,
    droppedAttributesCount: otherOverrides.droppedAttributesCount ?? 0,
    droppedEventsCount: otherOverrides.droppedEventsCount ?? 0,
    droppedLinksCount: otherOverrides.droppedLinksCount ?? 0,
    ...otherOverrides,
  } as ReadableSpan;

  return readableSpan;
}

export function createMockTraceForCollection(overrides: Partial<TraceForCollection> = {}): TraceForCollection {
  return {
    traceId: overrides.traceId ?? "test-trace-id",
    spans: overrides.spans ?? [
      {
        span_id: "test-span-id",
        trace_id: "test-trace-id",
        type: "llm",
        name: "test-span",
        timestamps: {
          started_at: 1000000,
          finished_at: 2000000,
        },
        params: {},
      },
    ],
    reservedTraceMetadata: overrides.reservedTraceMetadata ?? {},
    customMetadata: overrides.customMetadata ?? {},
    evaluations: overrides.evaluations ?? [],
    ...overrides,
  };
}

export function createMockExportTraceServiceRequest(overrides: Partial<IExportTraceServiceRequest> = {}): IExportTraceServiceRequest {
  return {
    resourceSpans: overrides.resourceSpans ?? [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "test-service" } }],
          droppedAttributesCount: 0,
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
                droppedAttributesCount: 0,
                events: [],
                droppedEventsCount: 0,
                status: { code: 0 },
                droppedLinksCount: 0,
                links: []
              },
            ],
          },
        ],
      },
    ] as IResourceSpans[],
    ...overrides,
  };
}
