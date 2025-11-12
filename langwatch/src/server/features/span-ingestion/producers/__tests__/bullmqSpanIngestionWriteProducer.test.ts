import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { SpanIngestionWriteProducerBullMq } from "../spanIngestionWriteProducerBullMq";
import { createMockReadableSpan } from "../../services/__tests__/testDoubles/testDataFactories";

// Mock the queue and tracer
vi.mock("../../../../background/queues/spanIngestionWriteQueue", () => ({
  spanIngestionWriteQueue: {
    add: vi.fn(),
  },
  SPAN_INGESTION_WRITE_JOB_NAME: "span_ingestion_write",
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: vi.fn(),
  })),
}));

vi.mock("../../../../utils/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

import { spanIngestionWriteQueue, SPAN_INGESTION_WRITE_JOB_NAME } from "../../../../background/queues/spanIngestionWriteQueue";
import type { Mock } from "vitest";
import { getLangWatchTracer } from "langwatch";

describe("SpanIngestionWriteProducerBullMq", () => {
  let producer: SpanIngestionWriteProducerBullMq;
  let mockQueueAdd: Mock;
  let mockTracerWithActiveSpan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock functions first
    const mockWithActiveSpan = vi.fn();
    const mockTracer = {
      withActiveSpan: mockWithActiveSpan,
      startSpan: vi.fn(),
      startActiveSpan: vi.fn(),
    };

    // Mock the tracer before creating producer
    vi.mocked(getLangWatchTracer).mockReturnValue(mockTracer);

    // Create producer after setting up mocks
    producer = new SpanIngestionWriteProducerBullMq();
    mockQueueAdd = spanIngestionWriteQueue.add.bind(spanIngestionWriteQueue) as Mock;
    mockTracerWithActiveSpan = vi.mocked(mockWithActiveSpan);

    // Setup tracer to call the callback
    mockTracerWithActiveSpan.mockImplementation(async (name, options, callback) => {
      if (typeof callback === 'function') {
        return callback();
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("enqueueSpanIngestionWriteJob", () => {
    it("adds job to queue with correct parameters", async () => {
      const tenantId = "test-tenant";
      const span = createMockReadableSpan({
        spanContext: {
          traceId: "test-trace-id",
          spanId: "test-span-id",
          traceFlags: 1,
          isRemote: false,
        },
      });

      mockQueueAdd.mockResolvedValue({ id: "job-123" });

      await producer.enqueueSpanIngestionWriteJob(tenantId, span);

      expect(mockQueueAdd).toHaveBeenCalledWith(
        SPAN_INGESTION_WRITE_JOB_NAME,
        {
          tenantId,
          spanData: span,
          collectedAtUnixMs: expect.any(Number),
        },
        {
          jobId: `${tenantId}:${span.spanContext().spanId}`,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
    });

    it("sets correct tracing attributes", async () => {
      const tenantId = "test-tenant";
      const traceId = "test-trace-id";
      const spanId = "test-span-id";
      const span = createMockReadableSpan({
        spanContext: {
          traceId,
          spanId,
          traceFlags: 1,
          isRemote: false,
        },
      });

      await producer.enqueueSpanIngestionWriteJob(tenantId, span);

      expect(mockTracerWithActiveSpan).toHaveBeenCalledWith(
        "SpanIngestionWriteProducerBullMq.enqueueSpan",
        {
          kind: SpanKind.PRODUCER,
          attributes: {
            "tenant_id": tenantId,
            "trace.id": traceId,
            "span.id": spanId,
          },
        },
        expect.any(Function)
      );
    });

    it("builds job ID with tenant and span ID", () => {
      const tenantId = "test-tenant";
      const spanId = "test-span-id";

      const result = (producer as any).buildJobId(tenantId, spanId);

      expect(result).toBe(`${tenantId}:${spanId}`);
    });

    it("builds job payload with correct structure", () => {
      const tenantId = "test-tenant";
      const span = createMockReadableSpan();
      const beforeTime = Date.now();

      const result = (producer as any).buildJobPayload(tenantId, span);

      const afterTime = Date.now();

      expect(result).toEqual({
        tenantId,
        spanData: span,
        collectedAtUnixMs: expect.any(Number),
      });

      expect(result.collectedAtUnixMs).toBeGreaterThanOrEqual(beforeTime);
      expect(result.collectedAtUnixMs).toBeLessThanOrEqual(afterTime);
    });

    describe("when queue add fails", () => {
      it("propagates the error", async () => {
        const tenantId = "test-tenant";
        const span = createMockReadableSpan();
        const queueError = new Error("Redis connection failed");

        mockQueueAdd.mockRejectedValue(queueError);

        await expect(
          producer.enqueueSpanIngestionWriteJob(tenantId, span)
        ).rejects.toThrow("Redis connection failed");
      });
    });
  });
});
