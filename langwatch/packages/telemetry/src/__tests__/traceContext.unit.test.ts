import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  context as otelContext,
  propagation,
  trace,
} from "@opentelemetry/api";
import { injectTraceContextHeaders, getActiveTraceId } from "../trace/traceContext";
import { INVALID_TRACE_ID } from "../constants";

vi.mock("@opentelemetry/api", () => ({
  context: { active: vi.fn(() => ({})) },
  propagation: { inject: vi.fn() },
  trace: { getActiveSpan: vi.fn(() => undefined) },
}));

describe("injectTraceContextHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when no active span exists", () => {
    it("returns headers unchanged and traceId as undefined", () => {
      const headers: Record<string, string> = { "content-type": "application/json" };

      const result = injectTraceContextHeaders({ headers });

      expect(result.headers).toBe(headers);
      expect(result.traceId).toBeUndefined();
      expect(propagation.inject).toHaveBeenCalledWith(
        expect.anything(),
        headers,
      );
    });
  });

  describe("when an active span exists", () => {
    it("returns the active trace ID", () => {
      vi.mocked(trace.getActiveSpan).mockReturnValue({
        spanContext: () => ({
          traceId: "abc123def456",
          spanId: "span789",
          traceFlags: 1,
        }),
      } as any);

      const headers: Record<string, string> = {};
      const result = injectTraceContextHeaders({ headers });

      expect(result.traceId).toBe("abc123def456");
      expect(propagation.inject).toHaveBeenCalled();
    });
  });
});

describe("getActiveTraceId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when no active span exists", () => {
    it("returns undefined", () => {
      vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

      expect(getActiveTraceId()).toBeUndefined();
    });
  });

  describe("when an active span has a valid trace ID", () => {
    it("returns the trace ID", () => {
      vi.mocked(trace.getActiveSpan).mockReturnValue({
        spanContext: () => ({
          traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      } as any);

      expect(getActiveTraceId()).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    });
  });

  describe("when an active span has an invalid (all-zeros) trace ID", () => {
    it("returns undefined", () => {
      vi.mocked(trace.getActiveSpan).mockReturnValue({
        spanContext: () => ({
          traceId: INVALID_TRACE_ID,
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      } as any);

      expect(getActiveTraceId()).toBeUndefined();
    });
  });

  describe("when an active span has an empty trace ID", () => {
    it("returns undefined", () => {
      vi.mocked(trace.getActiveSpan).mockReturnValue({
        spanContext: () => ({
          traceId: "",
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      } as any);

      expect(getActiveTraceId()).toBeUndefined();
    });
  });
});
