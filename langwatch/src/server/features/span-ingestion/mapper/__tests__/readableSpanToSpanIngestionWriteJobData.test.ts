import { describe, it, expect } from "vitest";
import { SpanKind, SpanStatusCode, type Link, type TraceState } from "@opentelemetry/api";
import { createMockReadableSpan } from "../../services/__tests__/testDoubles/testDataFactories";
import { mapReadableSpanToSpanIngestionWriteJobData } from "../readableSpanToSpanIngestionWriteJobData";

describe("mapReadableSpanToSpanIngestionWriteJobData", () => {
  describe("basic span context mapping", () => {
    it("maps traceId, spanId, and traceFlags correctly", () => {
      const span = createMockReadableSpan({
        spanContext: {
          traceId: "test-trace-123",
          spanId: "test-span-456",
          traceFlags: 1,
          isRemote: false,
        },
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.traceId).toBe("test-trace-123");
      expect(result.spanId).toBe("test-span-456");
      expect(result.traceFlags).toBe(1);
      expect(result.traceState).toBeNull();
      expect(result.isRemote).toBe(false);
    });

    it("handles traceState serialization", () => {
      // Note: The test factory doesn't support traceState overrides,
      // so this test uses the default behavior where traceState is undefined
      const span = createMockReadableSpan();

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.traceState).toBeNull(); // traceState is undefined/null by default
    });
  });

  describe("parent span context mapping", () => {
    it("maps parentSpanId when parentSpanContext exists", () => {
      const parentSpanContext = {
        traceId: "test-trace",
        spanId: "parent-span-789",
        traceFlags: 1,
      };

      const span = createMockReadableSpan({
        parentSpanContext,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.parentSpanId).toBe("parent-span-789");
    });

    it("sets parentSpanId to null when no parent exists", () => {
      const span = createMockReadableSpan({
        parentSpanContext: undefined,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.parentSpanId).toBeNull();
    });
  });

  describe("timestamp conversion", () => {
    it("converts HrTime startTime and endTime to unix milliseconds", () => {
      // Default test factory values: [1000000, 0] = 1,000,000 seconds = 1,000,000,000ms
      const startTime: [number, number] = [1000000, 0];
      // [2000000, 0] = 2,000,000 seconds = 2,000,000,000ms
      const endTime: [number, number] = [2000000, 0];

      const span = createMockReadableSpan({
        startTime,
        endTime,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.startTimeUnixMs).toBe(1000000000); // 1,000,000 * 1000
      expect(result.endTimeUnixMs).toBe(2000000000); // 2,000,000 * 1000
      expect(result.durationMs).toBe(1000000000); // 2,000,000,000 - 1,000,000,000
    });
  });

  describe("attributes mapping", () => {
    it("preserves span attributes as-is", () => {
      const attributes = {
        "gen_ai.operation.name": "chat",
        "gen_ai.usage.input_tokens": 100,
        custom_attr: "value",
      };

      const span = createMockReadableSpan({
        attributes,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.attributes).toEqual(attributes);
    });
  });

  describe("events mapping", () => {
    it("converts TimedEvent array to serializable format", () => {
      const events = [
        {
          name: "event1",
          time: [1000000, 500000] as [number, number], // 1,000,000.5 seconds = 1,000,000,500ms
          attributes: { key1: "value1" },
        },
        {
          name: "event2",
          time: [2000000, 0] as [number, number], // 2,000,000 seconds = 2,000,000,000ms
          attributes: { key2: "value2" },
        },
      ];

      const span = createMockReadableSpan({
        events,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.events).toEqual([
        {
          name: "event1",
          timeUnixMs: 1000000000.5, // 1,000,000 * 1000 + 500,000 / 1,000,000 = 1,000,000,000 + 0.5
          attributes: { key1: "value1" },
        },
        {
          name: "event2",
          timeUnixMs: 2000000000, // 2,000,000 * 1000 = 2,000,000,000
          attributes: { key2: "value2" },
        },
      ]);
    });

    it("handles empty events array", () => {
      const span = createMockReadableSpan({
        events: [],
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.events).toEqual([]);
    });
  });

  describe("links mapping", () => {
    it("converts Link array to serializable format", () => {
      // Create a mock Link that satisfies the OpenTelemetry Link interface
      const mockTraceState: TraceState = {
        serialize: () => "link-state-1",
        set: () => mockTraceState,
        unset: () => mockTraceState,
        get: () => undefined,
      };

      const links = [
        {
          context: {
            traceId: "link-trace-1",
            spanId: "link-span-1",
            traceFlags: 1,
            traceState: mockTraceState,
            isRemote: false,
          },
          attributes: { link_attr1: "value1" },
        },
      ] satisfies Link[];

      const span = createMockReadableSpan({
        links,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.links).toEqual([
        {
          traceId: "link-trace-1",
          spanId: "link-span-1",
          traceState: "link-state-1",
          attributes: { link_attr1: "value1" },
        },
      ]);
    });
  });

  describe("status mapping", () => {
    it("maps status with message", () => {
      const status = {
        code: SpanStatusCode.ERROR,
        message: "Something went wrong",
      };

      const span = createMockReadableSpan({
        status,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "Something went wrong",
      });
    });

    it("maps status without message", () => {
      const status = {
        code: SpanStatusCode.OK,
      };

      const span = createMockReadableSpan({
        status,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.status).toEqual({
        code: SpanStatusCode.OK,
        message: null,
      });
    });
  });

  describe("resource and instrumentation scope mapping", () => {
    it("maps resource attributes and instrumentation scope", () => {
      const resource = {
        attributes: {
          "service.name": "test-service",
          "service.version": "1.0.0",
        },
        merge: () => resource,
        getRawAttributes: () => [],
      };

      const instrumentationScope = {
        name: "test-library",
        version: "2.1.0",
      };

      const span = createMockReadableSpan({
        resource,
        instrumentationScope,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.resourceAttributes).toEqual({
        "service.name": "test-service",
        "service.version": "1.0.0",
      });

      expect(result.instrumentationScope).toEqual({
        name: "test-library",
        version: "2.1.0",
      });
    });

    it("handles missing instrumentation scope version", () => {
      const instrumentationScope: any = {
        name: "test-library",
        // version is optional in the real type but required in our DTO
      };

      const span = createMockReadableSpan({
        instrumentationScope,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.instrumentationScope.version).toBeNull();
    });
  });

  describe("metadata fields", () => {
    it("maps all metadata fields correctly", () => {
      const span = createMockReadableSpan({
        ended: true,
        droppedAttributesCount: 5,
        droppedEventsCount: 2,
        droppedLinksCount: 1,
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result.ended).toBe(true);
      expect(result.droppedAttributesCount).toBe(5);
      expect(result.droppedEventsCount).toBe(2);
      expect(result.droppedLinksCount).toBe(1);
    });
  });

  describe("complex span mapping", () => {
    it("maps a complete complex span correctly", () => {
      const span = createMockReadableSpan({
        name: "complex-span",
        kind: SpanKind.INTERNAL,
        spanContext: {
          traceId: "complex-trace",
          spanId: "complex-span",
          traceFlags: 1,
          isRemote: false,
        },
        parentSpanContext: {
          traceId: "complex-trace",
          spanId: "parent-span",
          traceFlags: 1,
        },
        startTime: [10, 500000000], // 10500ms
        endTime: [15, 250000000], // 15250ms
        attributes: {
          "gen_ai.operation.name": "chat",
          custom: "value",
        },
        events: [
          {
            name: "start_processing",
            time: [10, 750000000], // 10750ms
            attributes: { step: 1 },
          },
        ],
        status: {
          code: SpanStatusCode.OK,
        },
        resource: {
          attributes: { "service.name": "complex-service" },
          merge: () => ({} as any),
          getRawAttributes: () => [],
        },
        instrumentationScope: {
          name: "complex-library",
          version: "1.0.0",
        },
      });

      const result = mapReadableSpanToSpanIngestionWriteJobData(span);

      expect(result).toMatchObject({
        traceId: "complex-trace",
        spanId: "complex-span",
        parentSpanId: "parent-span",
        name: "complex-span",
        kind: SpanKind.INTERNAL,
        startTimeUnixMs: 10500,
        endTimeUnixMs: 15250,
        durationMs: 4750,
        attributes: {
          "gen_ai.operation.name": "chat",
          custom: "value",
        },
        events: [
          {
            name: "start_processing",
            timeUnixMs: 10750,
            attributes: { step: 1 },
          },
        ],
        status: {
          code: SpanStatusCode.OK,
          message: null,
        },
        resourceAttributes: { "service.name": "complex-service" },
        instrumentationScope: {
          name: "complex-library",
          version: "1.0.0",
        },
        ended: true,
      });
    });
  });
});
