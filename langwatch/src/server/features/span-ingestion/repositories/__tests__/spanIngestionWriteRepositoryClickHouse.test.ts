import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { SpanIngestionWriteRepositoryClickHouse } from "../spanIngestionWriteRepositoryClickHouse";
import type { SpanIngestionWriteJob } from "../../types";
import type { ClickHouseClient } from "@clickhouse/client";

// Mock dependencies
vi.mock("@clickhouse/client");
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

describe("SpanIngestionWriteRepositoryClickHouse", () => {
  let repository: SpanIngestionWriteRepositoryClickHouse;
  let mockClickHouseClient: ClickHouseClient;
  let mockInsert: ReturnType<typeof vi.fn>;

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
    mockInsert = vi.fn().mockResolvedValue(undefined);
    mockClickHouseClient = {
      insert: mockInsert,
    } as unknown as ClickHouseClient;

    repository = new SpanIngestionWriteRepositoryClickHouse(mockClickHouseClient);

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

  describe("insertSpan", () => {
    describe("when insert succeeds", () => {
      it("calls ClickHouse insert with transformed data", async () => {
        await repository.insertSpan(mockJobData);

        expect(mockInsert).toHaveBeenCalledWith({
          table: "observability_spans",
          values: [expect.objectContaining({
            Id: expect.any(String),
            TraceId: "test-trace-id",
            SpanId: "test-span-id",
            SpanName: "test-span",
            LangWatchTenantId: "test-tenant",
          })],
          format: "JSONEachRow",
        });
      });
    });

    describe("when insert fails", () => {
      it("re-throws the error", async () => {
        const insertError = new Error("ClickHouse connection failed");
        mockInsert.mockRejectedValue(insertError);

        await expect(repository.insertSpan(mockJobData)).rejects.toThrow("ClickHouse connection failed");
      });
    });
  });

  describe("transformSpanData", () => {
    describe("when service name is string", () => {
      it("uses the string service name", () => {
        const result = (repository as any).transformSpanData(mockJobData);

        expect(result.ServiceName).toBe("test-service");
      });
    });

    describe("when service name is not string", () => {
      it("defaults to unknown", () => {
        const jobWithNonStringServiceName = {
          ...mockJobData,
          spanData: {
            ...mockJobData.spanData,
            resourceAttributes: { "service.name": 123 },
          },
        };

        const result = (repository as any).transformSpanData(jobWithNonStringServiceName);

        expect(result.ServiceName).toBe("unknown");
      });
    });

    describe("when resource attributes are undefined", () => {
      it("uses empty object", () => {
        const jobWithUndefinedResourceAttrs = {
          ...mockJobData,
          spanData: {
            ...mockJobData.spanData,
            resourceAttributes: undefined,
          },
        };

        const result = (repository as any).transformSpanData(jobWithUndefinedResourceAttrs);

        expect(result.ResourceAttributes).toEqual({});
      });
    });
  });

  describe("mapSpanKind", () => {
    describe("when kind is INTERNAL", () => {
      it("returns INTERNAL", () => {
        const result = (repository as any).mapSpanKind(SpanKind.INTERNAL);
        expect(result).toBe("INTERNAL");
      });
    });

    describe("when kind is SERVER", () => {
      it("returns SERVER", () => {
        const result = (repository as any).mapSpanKind(SpanKind.SERVER);
        expect(result).toBe("SERVER");
      });
    });

    describe("when kind is CLIENT", () => {
      it("returns CLIENT", () => {
        const result = (repository as any).mapSpanKind(SpanKind.CLIENT);
        expect(result).toBe("CLIENT");
      });
    });

    describe("when kind is PRODUCER", () => {
      it("returns PRODUCER", () => {
        const result = (repository as any).mapSpanKind(SpanKind.PRODUCER);
        expect(result).toBe("PRODUCER");
      });
    });

    describe("when kind is CONSUMER", () => {
      it("returns CONSUMER", () => {
        const result = (repository as any).mapSpanKind(SpanKind.CONSUMER);
        expect(result).toBe("CONSUMER");
      });
    });

    describe("when kind is unknown", () => {
      it("defaults to INTERNAL", () => {
        const result = (repository as any).mapSpanKind(999 as SpanKind);
        expect(result).toBe("INTERNAL");
      });
    });
  });

  describe("mapStatusCode", () => {
    describe("when code is 0", () => {
      it("returns UNSET", () => {
        const result = (repository as any).mapStatusCode(0);
        expect(result).toBe("UNSET");
      });
    });

    describe("when code is 1", () => {
      it("returns OK", () => {
        const result = (repository as any).mapStatusCode(1);
        expect(result).toBe("OK");
      });
    });

    describe("when code is 2", () => {
      it("returns ERROR", () => {
        const result = (repository as any).mapStatusCode(2);
        expect(result).toBe("ERROR");
      });
    });

    describe("when code is unknown", () => {
      it("defaults to UNSET", () => {
        const result = (repository as any).mapStatusCode(999);
        expect(result).toBe("UNSET");
      });
    });
  });
});
