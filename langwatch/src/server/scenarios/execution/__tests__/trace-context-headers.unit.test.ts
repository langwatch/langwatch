/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => {
  const mockInject = vi.fn();
  const mockActive = vi.fn();
  const mockGetActiveSpan = vi.fn();
  return {
    context: { active: mockActive },
    propagation: { inject: mockInject },
    trace: { getActiveSpan: mockGetActiveSpan },
  };
});

import { context as otelContext, propagation, trace } from "@opentelemetry/api";
import {
  injectTraceContextHeaders,
  getActiveTraceId,
} from "../trace-context-headers";

const mockInject = vi.mocked(propagation.inject);
const mockActive = vi.mocked(otelContext.active);
const mockGetActiveSpan = vi.mocked(trace.getActiveSpan);

describe("injectTraceContextHeaders()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActive.mockReturnValue({} as ReturnType<typeof otelContext.active>);
  });

  describe("when an active OTEL context exists", () => {
    beforeEach(() => {
      mockInject.mockImplementation((_ctx, carrier) => {
        const headers = carrier as Record<string, string>;
        headers["traceparent"] =
          "00-abcdef1234567890abcdef1234567890-1234567890abcdef-01";
      });
      mockGetActiveSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "abcdef1234567890abcdef1234567890",
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      } as ReturnType<typeof trace.getActiveSpan>);
    });

    it("injects traceparent header via OTEL propagation", () => {
      const headers: Record<string, string> = {};

      const result = injectTraceContextHeaders({ headers });

      expect(mockInject).toHaveBeenCalledWith(expect.anything(), headers);
      expect(result.headers["traceparent"]).toBe(
        "00-abcdef1234567890abcdef1234567890-1234567890abcdef-01"
      );
    });

    it("injects x-langwatch-scenario-run header with batch run ID", () => {
      const headers: Record<string, string> = {};

      const result = injectTraceContextHeaders({ headers, batchRunId: "batch_abc123" });

      expect(result.headers["x-langwatch-scenario-run"]).toBe("batch_abc123");
    });

    it("returns the captured trace ID", () => {
      const headers: Record<string, string> = {};

      const result = injectTraceContextHeaders({ headers });

      expect(result.traceId).toBe("abcdef1234567890abcdef1234567890");
    });

    it("preserves existing headers", () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Custom": "custom-value",
      };

      const result = injectTraceContextHeaders({ headers, batchRunId: "batch_abc123" });

      expect(result.headers["Content-Type"]).toBe("application/json");
      expect(result.headers["X-Custom"]).toBe("custom-value");
      expect(result.headers["traceparent"]).toBeDefined();
      expect(result.headers["x-langwatch-scenario-run"]).toBe("batch_abc123");
    });
  });

  describe("when no active OTEL context exists", () => {
    beforeEach(() => {
      // propagation.inject is a no-op when no context
      mockInject.mockImplementation(() => {});
      mockGetActiveSpan.mockReturnValue(undefined);
    });

    it("proceeds without traceparent header", () => {
      const headers: Record<string, string> = {};

      injectTraceContextHeaders({ headers });

      expect(headers["traceparent"]).toBeUndefined();
    });

    it("does not throw", () => {
      const headers: Record<string, string> = {};

      expect(() => injectTraceContextHeaders({ headers })).not.toThrow();
    });

    it("returns undefined trace ID", () => {
      const headers: Record<string, string> = {};

      const result = injectTraceContextHeaders({ headers });

      expect(result.traceId).toBeUndefined();
    });

    it("still injects correlation header when batchRunId provided", () => {
      const headers: Record<string, string> = {};

      injectTraceContextHeaders({ headers, batchRunId: "batch_xyz" });

      expect(headers["x-langwatch-scenario-run"]).toBe("batch_xyz");
    });
  });

  describe("when batchRunId is not provided", () => {
    it("does not add x-langwatch-scenario-run header", () => {
      const headers: Record<string, string> = {};

      injectTraceContextHeaders({ headers });

      expect(headers["x-langwatch-scenario-run"]).toBeUndefined();
    });
  });
});

describe("getActiveTraceId()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when an active span exists", () => {
    it("returns the trace ID", () => {
      mockGetActiveSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "abcdef1234567890abcdef1234567890",
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      } as ReturnType<typeof trace.getActiveSpan>);

      expect(getActiveTraceId()).toBe("abcdef1234567890abcdef1234567890");
    });
  });

  describe("when no active span exists", () => {
    it("returns undefined", () => {
      mockGetActiveSpan.mockReturnValue(undefined);

      expect(getActiveTraceId()).toBeUndefined();
    });
  });

  describe("when trace ID is the invalid zero value", () => {
    it("returns undefined", () => {
      mockGetActiveSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "00000000000000000000000000000000",
          spanId: "0000000000000000",
          traceFlags: 0,
        }),
      } as ReturnType<typeof trace.getActiveSpan>);

      expect(getActiveTraceId()).toBeUndefined();
    });
  });
});
