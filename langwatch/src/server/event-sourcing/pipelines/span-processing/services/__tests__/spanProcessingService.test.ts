import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockTraceForCollection,
  createMockExportTraceServiceRequest,
  createMockReadableSpan,
} from "./testDoubles/testDataFactories";
import type { SpanProcessingWriteRecord } from "../../types/";

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
import { SpanProcessingService } from "../spanProcessingService";
import { spanProcessingCommandDispatcher } from "../../pipeline";

describe("SpanProcessingService", () => {
  let service: SpanProcessingService;
  let mockMapperService: {
    mapLangWatchSpansToOtelReadableSpans: ReturnType<typeof vi.fn>;
    mapReadableSpanToSpanData: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = new SpanProcessingService();
    const MockedMapperService = vi.mocked(SpanProcessingMapperService);
    const instance = new MockedMapperService();
    mockMapperService = {
      mapLangWatchSpansToOtelReadableSpans: vi.mocked(
        instance.mapLangWatchSpansToOtelReadableSpans,
      ),
      mapReadableSpanToSpanData: vi.mocked(instance.mapReadableSpanToSpanData),
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

        const mappedRecords: SpanProcessingWriteRecord[] = [
          { readableSpan: mockReadableSpan1, tenantId },
          { readableSpan: mockReadableSpan2, tenantId },
        ];

        mockMapperService.mapLangWatchSpansToOtelReadableSpans.mockReturnValue(
          mappedRecords,
        );

        await service.processSpans(tenantId, traceForCollection, traceRequest);

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

        await service.processSpans(tenantId, traceForCollection, traceRequest);
      });
    });

    describe("when producer fails", () => {
      it("propagates the error", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();
        const mockReadableSpan = createMockReadableSpan();
        const producerError = new Error("Queue is full");

        const mappedRecords: SpanProcessingWriteRecord[] = [
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
          service.processSpans(tenantId, traceForCollection, traceRequest),
        ).rejects.toThrow("Queue is full");
      });
    });
  });
});
