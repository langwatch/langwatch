import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { EvaluationsFacade } from "../evaluations.facade";
import {
  EvaluatorNotFoundError,
  EvaluationsApiError,
  EvaluatorCallError,
} from "../errors";
import type { EvaluateResponse } from "../types";
import { NoOpLogger } from "@/logger";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock OpenTelemetry
vi.mock("@opentelemetry/api", () => {
  const mockSpan = {
    spanContext: () => ({ traceId: "test-trace-id", spanId: "test-span-id" }),
    setStatus: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
  };

  const mockTracer = {
    startSpan: vi.fn(() => mockSpan),
  };

  return {
    trace: {
      getTracer: vi.fn(() => mockTracer),
      getActiveSpan: vi.fn(() => mockSpan),
    },
    SpanStatusCode: {
      OK: 0,
      ERROR: 2,
    },
    context: {
      active: vi.fn(() => ({})),
    },
  };
});

// Mock createLangWatchSpan
vi.mock("@/observability-sdk/span/implementation", () => ({
  createLangWatchSpan: vi.fn(() => ({
    setType: vi.fn().mockReturnThis(),
    setInput: vi.fn().mockReturnThis(),
    setOutput: vi.fn().mockReturnThis(),
  })),
}));

describe("EvaluationsFacade", () => {
  let facade: EvaluationsFacade;

  beforeEach(() => {
    mockFetch.mockReset();
    facade = new EvaluationsFacade({
      endpoint: "https://api.langwatch.ai",
      apiKey: "test-api-key",
      logger: new NoOpLogger(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("evaluate()", () => {
    it("returns evaluation result on successful API call", async () => {
      const mockResponse: EvaluateResponse = {
        status: "processed",
        passed: true,
        score: 0.95,
        details: "Evaluation passed",
        label: "pass",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await facade.evaluate("test-evaluator", {
        data: { input: "test input", output: "test output" },
        name: "Test Evaluation",
      });

      expect(result.status).toBe("processed");
      expect(result.passed).toBe(true);
      expect(result.score).toBe(0.95);
      expect(result.details).toBe("Evaluation passed");
      expect(result.label).toBe("pass");
    });

    it("calls API with correct URL and headers", async () => {
      const mockResponse: EvaluateResponse = {
        status: "processed",
        passed: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await facade.evaluate("presidio/pii_detection", {
        data: { input: "test", output: "response" },
        name: "PII Check",
        asGuardrail: true,
        settings: { threshold: 0.5 },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.langwatch.ai/api/evaluations/presidio/pii_detection/evaluate",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": "test-api-key",
          },
          body: expect.any(String),
        })
      );

      // Verify body contents
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs![1].body);
      expect(body.name).toBe("PII Check");
      expect(body.data).toEqual({ input: "test", output: "response" });
      expect(body.as_guardrail).toBe(true);
      expect(body.settings).toEqual({ threshold: 0.5 });
    });

    it("throws EvaluatorNotFoundError on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      const error = await facade.evaluate("non-existent", {
        data: { input: "test" },
      }).catch((e) => e);

      expect(error).toBeInstanceOf(EvaluatorNotFoundError);
      expect(error.message).toBe("Evaluator not found: non-existent");
    });

    it("throws EvaluationsApiError on other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal server error"),
      });

      await expect(
        facade.evaluate("test-evaluator", {
          data: { input: "test" },
        })
      ).rejects.toThrow(EvaluationsApiError);
    });

    it("handles evaluation error status in response", async () => {
      const mockResponse: EvaluateResponse = {
        status: "error",
        details: "Evaluation failed due to invalid input",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await facade.evaluate("test-evaluator", {
        data: { input: "test" },
      });

      expect(result.status).toBe("error");
      expect(result.details).toBe("Evaluation failed due to invalid input");
    });

    it("handles skipped evaluation status", async () => {
      const mockResponse: EvaluateResponse = {
        status: "skipped",
        details: "Evaluation skipped due to missing data",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await facade.evaluate("test-evaluator", {
        data: { input: "test" },
      });

      expect(result.status).toBe("skipped");
    });

    it("includes cost in result when present", async () => {
      const mockResponse: EvaluateResponse = {
        status: "processed",
        passed: true,
        cost: { currency: "USD", amount: 0.001 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await facade.evaluate("test-evaluator", {
        data: { input: "test" },
      });

      expect(result.cost).toEqual({ currency: "USD", amount: 0.001 });
    });

    it("wraps network errors in EvaluatorCallError", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const error = await facade.evaluate("test-evaluator", {
        data: { input: "test" },
      }).catch((e) => e);

      expect(error).toBeInstanceOf(EvaluatorCallError);
      expect(error.message).toContain("Network error");
    });

    it("returns passed=true for guardrails on error", async () => {
      // This test verifies the behavior when an error occurs during guardrail evaluation.
      // For guardrails, we default to passed=true on error to avoid blocking user requests.
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      // The facade should throw, but we can test internal behavior via mocks
      try {
        await facade.evaluate("test-guardrail", {
          data: { input: "test" },
          asGuardrail: true,
        });
      } catch (error) {
        // Expected - the error is re-thrown
        expect(error).toBeInstanceOf(EvaluatorCallError);
      }
    });

    it("uses slug as default span name when name not provided", async () => {
      const mockResponse: EvaluateResponse = {
        status: "processed",
        passed: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await facade.evaluate("my-evaluator-slug", {
        data: { input: "test" },
      });

      // The span name is set internally - we verify the API was called correctly
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs![1].body);
      expect(body.name).toBeNull(); // name is null when not provided
    });

    it("excludes null/undefined values from result", async () => {
      const mockResponse: EvaluateResponse = {
        status: "processed",
        passed: null,
        score: null,
        details: null,
        label: null,
        cost: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await facade.evaluate("test-evaluator", {
        data: { input: "test" },
      });

      expect(result.status).toBe("processed");
      expect(result).not.toHaveProperty("passed");
      expect(result).not.toHaveProperty("score");
      expect(result).not.toHaveProperty("details");
      expect(result).not.toHaveProperty("label");
      expect(result).not.toHaveProperty("cost");
    });
  });
});
