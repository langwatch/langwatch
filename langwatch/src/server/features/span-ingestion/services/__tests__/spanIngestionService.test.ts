import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpanIngestionService } from "../spanIngestionService";
import { MockSpanIngestionWriteProducer } from "./testDoubles/mockSpanIngestionWriteProducer";
import {
  createMockTraceForCollection,
  createMockExportTraceServiceRequest,
  createMockReadableSpan,
} from "./testDoubles/testDataFactories";
import type { SpanIngestionWriteRecord } from "../../types/";

// Mock the mapper function
vi.mock("../../mapper/mapLangWatchToOtelGenAi", () => ({
  mapLangWatchSpansToOtelReadableSpans: vi.fn(),
}));

// Import after mocking
import { mapLangWatchSpansToOtelReadableSpans } from "../../mapper/mapLangWatchToOtelGenAi";

describe("SpanIngestionService", () => {
  let mockProducer: MockSpanIngestionWriteProducer;
  let service: SpanIngestionService;
  let mockMapLangWatchSpansToOtelReadableSpans: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProducer = new MockSpanIngestionWriteProducer();
    service = new SpanIngestionService(mockProducer);
    mockMapLangWatchSpansToOtelReadableSpans = vi.mocked(mapLangWatchSpansToOtelReadableSpans);
  });

  afterEach(() => {
    mockProducer.reset();
    vi.clearAllMocks();
  });

  describe("when consuming spans to be ingested", () => {
    describe("when spans are successfully mapped", () => {
      it("enqueues jobs for each mapped span", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();
        const mockReadableSpan1 = createMockReadableSpan({ name: "span-1" });
        const mockReadableSpan2 = createMockReadableSpan({ name: "span-2" });

        const mappedRecords: SpanIngestionWriteRecord[] = [
          { readableSpan: mockReadableSpan1, tenantId },
          { readableSpan: mockReadableSpan2, tenantId },
        ];

        mockMapLangWatchSpansToOtelReadableSpans.mockReturnValue(mappedRecords);

        await service.consumeSpans(tenantId, traceForCollection, traceRequest);

        expect(mockProducer.getCallCount()).toBe(2);
        expect(mockProducer.getCalls()).toEqual([
          { tenantId, span: mockReadableSpan1 },
          { tenantId, span: mockReadableSpan2 },
        ]);
      });
    });

    describe("when no spans are mapped", () => {
      it("skips enqueuing jobs", async () => {
        const tenantId = "test-tenant";
        const traceForCollection = createMockTraceForCollection();
        const traceRequest = createMockExportTraceServiceRequest();

        mockMapLangWatchSpansToOtelReadableSpans.mockReturnValue([]);

        await service.consumeSpans(tenantId, traceForCollection, traceRequest);

        expect(mockProducer.getCallCount()).toBe(0);
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

        mockMapLangWatchSpansToOtelReadableSpans.mockReturnValue(mappedRecords);
        mockProducer.setShouldThrowError(true, producerError);

        await expect(
          service.consumeSpans(tenantId, traceForCollection, traceRequest)
        ).rejects.toThrow("Queue is full");
      });
    });
  });
});
