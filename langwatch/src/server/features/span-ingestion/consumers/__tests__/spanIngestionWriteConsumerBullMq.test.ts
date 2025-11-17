import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { SpanIngestionWriteConsumerBullMq } from "../spanIngestionWriteConsumerBullMq";
import type { SpanIngestionWriteJob } from "../../types";
import type { SpanIngestionWriteRepository } from "../../repositories";

// Mock dependencies
vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: vi.fn(),
  })),
}));
vi.mock("../../../../utils/logger", () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

// Mock the tracer to call the callback
const mockWithActiveSpan = vi.fn();
vi.mocked(getLangWatchTracer).mockReturnValue({
  withActiveSpan: mockWithActiveSpan,
  startSpan: vi.fn(),
  startActiveSpan: vi.fn(),
});

import { getLangWatchTracer } from "langwatch";

describe("SpanIngestionWriteConsumerBullMq", () => {
  let consumer: SpanIngestionWriteConsumerBullMq;
  let mockRepository: SpanIngestionWriteRepository;
  let mockInsertSpan: ReturnType<typeof vi.fn>;

  const mockJobData: SpanIngestionWriteJob = {
    tenantId: "test-tenant",
    collectedAtUnixMs: Date.now(),
    spanData: {
      traceId: "test-trace-id",
      spanId: "test-span-id",
      traceFlags: 1,
      traceState: null,
      isRemote: false,
      parentSpanId: null,
      name: "test-span",
      kind: SpanKind.INTERNAL,
      startTimeUnixMs: 1000000,
      endTimeUnixMs: 2000000,
      durationMs: 1000,
      attributes: { "test.key": "test.value" },
      events: [],
      links: [],
      status: { code: 0, message: null },
      resourceAttributes: { "service.name": "test-service" },
      instrumentationScope: { name: "test-library", version: "1.0.0" },
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
  };

  beforeEach(() => {
    mockInsertSpan = vi.fn().mockResolvedValue(undefined);
    mockRepository = {
      insertSpan: mockInsertSpan,
    } as SpanIngestionWriteRepository;

    consumer = new SpanIngestionWriteConsumerBullMq(mockRepository);

    // Setup tracer to call the callback with a mock span
    mockWithActiveSpan.mockImplementation(async (name, options, callback) => {
      if (typeof callback === 'function') {
        const mockSpan = {
          setAttribute: vi.fn(),
          end: vi.fn(),
        };
        return callback(mockSpan);
      }
    });
  });

  describe("consume", () => {
    describe("when repository insert succeeds", () => {
      it("calls repository insertSpan", async () => {
        await consumer.consume(mockJobData);

        expect(mockInsertSpan).toHaveBeenCalledWith(mockJobData);
      });
    });

    describe("when repository insert fails", () => {
      it("re-throws the error", async () => {
        const repositoryError = new Error("Database connection failed");
        mockInsertSpan.mockRejectedValue(repositoryError);

        await expect(consumer.consume(mockJobData)).rejects.toThrow("Database connection failed");
      });
    });
  });
});
