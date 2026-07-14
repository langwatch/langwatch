/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTraceApiSpanQuery } from "../trace-api-span-query";

const ENDPOINT = "http://localhost:3000";
const API_KEY = "test-api-key";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("createTraceApiSpanQuery()", () => {
  const querySpans = createTraceApiSpanQuery({
    endpoint: ENDPOINT,
    apiKey: API_KEY,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when trace exists with spans", () => {
    it("returns the spans from the API response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          trace_id: "trace_abc",
          spans: [
            {
              span_id: "span1",
              trace_id: "trace_abc",
              type: "llm",
              name: "test-span",
              timestamps: { started_at: 1000, finished_at: 2000 },
            },
          ],
        }),
      });

      const spans = await querySpans({
        projectId: "project_123",
        traceId: "trace_abc",
      });

      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe("test-span");
    });

    it("passes the API key as x-auth-token header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ trace_id: "t", spans: [] }),
      });

      await querySpans({ projectId: "project_123", traceId: "trace_abc" });

      expect(mockFetch).toHaveBeenCalledWith(
        `${ENDPOINT}/api/trace/trace_abc`,
        expect.objectContaining({
          headers: { "x-auth-token": API_KEY },
        }),
      );
    });
  });

  describe("when trace is not found (404)", () => {
    it("returns empty array", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const spans = await querySpans({
        projectId: "project_123",
        traceId: "trace_missing",
      });

      expect(spans).toEqual([]);
    });
  });

  describe("when API returns a server error", () => {
    it("throws with status information", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        querySpans({ projectId: "project_123", traceId: "trace_error" }),
      ).rejects.toThrow("Trace API returned 500");
    });
  });

  describe("when fetch exceeds timeout", () => {
    it("passes a 30-second AbortSignal.timeout to fetch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ trace_id: "t", spans: [] }),
      });

      await querySpans({ projectId: "project_123", traceId: "trace_abc" });

      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeDefined();
      // AbortSignal.timeout returns an AbortSignal, verify it's present
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("when trace has no spans property", () => {
    it("returns empty array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ trace_id: "trace_no_spans" }),
      });

      const spans = await querySpans({
        projectId: "project_123",
        traceId: "trace_no_spans",
      });

      expect(spans).toEqual([]);
    });
  });
});
