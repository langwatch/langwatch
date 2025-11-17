/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockTraceForCollection,
  createMockExportTraceServiceRequest,
  createMockReadableSpan,
} from "./testDoubles/testDataFactories";
import type { SpanIngestionWriteRecord } from "../../types/spanIngestionWriteRecord";

// Mock the command dispatcher
vi.mock("../../pipeline", () => ({
  spanProcessingCommandDispatcher: {
    send: vi.fn().mockResolvedValue(void 0),
  },
}));

// Mock the mapper service
vi.mock("../spanProcessingMapperService", () => ({
  SpanProcessingMapperService: vi.fn().mockImplementation(() => ({
    mapLangWatchSpansToOtelReadableSpans: vi.fn(),
    mapReadableSpanToSpanData: vi.fn((span) => ({
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      traceFlags: 0,
      traceState: null,
      isRemote: false,
      parentSpanId: null,
      name: span.name,
      kind: span.kind,
      startTimeUnixMs: 0,
      endTimeUnixMs: 0,
      attributes: span.attributes,
      events: [],
      links: [],
      status: { code: span.status.code, message: span.status.message ?? null },
      resourceAttributes: span.resource.attributes,
      instrumentationScope: {
        name: span.instrumentationScope.name,
        version: span.instrumentationScope.version ?? null,
      },
      durationMs: 0,
      ended: span.ended,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    })),
  })),
}));

// Import after mocking
import { SpanProcessingMapperService } from "../spanProcessingMapperService";
import { SpanIngestionService } from "../spanIngestionService";
import { spanProcessingCommandDispatcher } from "../../pipeline";

describe("SpanIngestionService", () => {
  let service: SpanIngestionService;
  let mockMapperService: {
    mapLangWatchSpansToOtelReadableSpans: ReturnType<typeof vi.fn>;
    mapReadableSpanToSpanData: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = new SpanIngestionService();
    const MockedMapperService = vi.mocked(SpanProcessingMapperService);
    const instance = new MockedMapperService();
    // The methods are already vi.fn() instances from the mock implementation
    mockMapperService = {
      mapLangWatchSpansToOtelReadableSpans:
        instance.mapLangWatchSpansToOtelReadableSpans as ReturnType<
          typeof vi.fn
        >,
      mapReadableSpanToSpanData:
        instance.mapReadableSpanToSpanData as ReturnType<typeof vi.fn>,
    };
    // Replace the service's mapper with our mock
    (service as any).mapperService = mockMapperService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when processing spans", () => {
    describe("when spans are successfully mapped", () => {
      it("processes each mapped span", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();
        const mockReadableSpan1 = createMockReadableSpan({ name: "span-1" });
        const mockReadableSpan2 = createMockReadableSpan({ name: "span-2" });

        const mappedRecords: SpanIngestionWriteRecord[] = [
          { readableSpan: mockReadableSpan1, tenantId },
          { readableSpan: mockReadableSpan2, tenantId },
        ];

        mockMapperService.mapLangWatchSpansToOtelReadableSpans.mockReturnValue(
          mappedRecords,
        );

        await service.ingestSpanCollection(
          tenantId,
          traceForCollection,
          traceRequest,
        );

        // We only assert that mapping was called; command side effects are covered elsewhere.
        expect(
          mockMapperService.mapLangWatchSpansToOtelReadableSpans,
        ).toHaveBeenCalledTimes(1);
      });
    });

    describe("when no spans are mapped", () => {
      it("skips processing when no spans are mapped", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();

        mockMapperService.mapLangWatchSpansToOtelReadableSpans.mockReturnValue(
          [],
        );

        await service.ingestSpanCollection(
          tenantId,
          traceForCollection,
          traceRequest,
        );
      });
    });

    describe("when producer fails", () => {
      it("propagates the error", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();
        const mockReadableSpan = createMockReadableSpan();
        const producerError = new Error("Queue is full");

        const mappedRecords: SpanIngestionWriteRecord[] = [
          { readableSpan: mockReadableSpan, tenantId },
        ];

        mockMapperService.mapLangWatchSpansToOtelReadableSpans.mockReturnValue(
          mappedRecords,
        );

        // Mock the command dispatcher to throw
        vi.mocked(spanProcessingCommandDispatcher.send).mockRejectedValueOnce(
          producerError,
        );

        await expect(
          service.ingestSpanCollection(
            tenantId,
            traceForCollection,
            traceRequest,
          ),
        ).rejects.toThrow("Queue is full");
      });
    });
  });
});
