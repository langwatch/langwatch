/**
 * @vitest-environment node
 *
 * Unit tests for LangEvalsHttpClient.
 *
 * Strategy: mock global.fetch for network I/O, vi.mock only for
 * metrics/logging (infrastructure concerns, not business logic).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluatorExecutionError } from "../../../evaluations/errors";
import type { LangEvalsEvaluateParams } from "../langevals.client";
import { LangEvalsHttpClient } from "../langevals.http.client";

vi.mock("~/server/metrics", () => ({
  evaluationDurationHistogram: {
    labels: () => ({ observe: vi.fn() }),
  },
  getEvaluationStatusCounter: () => ({ inc: vi.fn() }),
}));

vi.mock("~/server/tracer/tracesMapping", () => ({
  tryAndConvertTo: (value: unknown) => value,
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

function buildParams(overrides?: Partial<LangEvalsEvaluateParams>): LangEvalsEvaluateParams {
  return {
    evaluatorType: "test/evaluator",
    data: { input: "hello", output: "world" },
    settings: {},
    env: { API_KEY: "key-123" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LangEvalsHttpClient", () => {
  const endpoint = "http://langevals:8000";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("evaluate()", () => {
    describe("when langevals returns a successful result", () => {
      it("returns the first result from the batch response", async () => {
        const expected = { status: "processed" as const, score: 0.95, passed: true };
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse([expected]),
        );

        const client = new LangEvalsHttpClient(endpoint);
        const result = await client.evaluate(buildParams());

        expect(result).toEqual(expected);
      });

      it("calls fetch with correct URL and body", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse([{ status: "processed", score: 1 }]),
        );

        const client = new LangEvalsHttpClient(endpoint);
        await client.evaluate(buildParams({ evaluatorType: "openai/moderation" }));

        expect(fetchSpy).toHaveBeenCalledWith(
          `${endpoint}/openai/moderation/evaluate`,
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
        );
      });
    });

    describe("when fetch throws a network error", () => {
      it("throws EvaluatorExecutionError", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
          new TypeError("fetch failed"),
        );

        const client = new LangEvalsHttpClient(endpoint);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          EvaluatorExecutionError,
        );
        await expect(client.evaluate(buildParams())).rejects.toThrow(
          "Evaluator cannot be reached",
        );
      });
    });

    describe("when langevals returns 500 and retries are available", () => {
      it("retries and returns result on second attempt", async () => {
        const expected = { status: "processed" as const, score: 0.8 };
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(jsonResponse({ error: "internal" }, 500))
          .mockResolvedValueOnce(jsonResponse([expected]));

        const client = new LangEvalsHttpClient(endpoint, 1);

        const resultPromise = client.evaluate(buildParams());
        // Advance past the 100ms retry delay
        await vi.advanceTimersByTimeAsync(150);
        const result = await resultPromise;

        expect(result).toEqual(expected);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe("when langevals returns 500 and no retries left", () => {
      it("throws EvaluatorExecutionError with status and body", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse({ error: "internal server error" }, 500),
        );

        const client = new LangEvalsHttpClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          EvaluatorExecutionError,
        );
      });
    });

    describe("when langevals returns 4xx", () => {
      it("throws EvaluatorExecutionError without retrying", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse({ error: "bad request" }, 400),
        );

        const client = new LangEvalsHttpClient(endpoint, 2);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          EvaluatorExecutionError,
        );
        // Should NOT retry on 4xx
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("when langevals returns empty results array", () => {
      it("throws EvaluatorExecutionError", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse([]),
        );

        const client = new LangEvalsHttpClient(endpoint);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          "Unexpected response: empty results",
        );
      });
    });

    describe("when constructed with maxRetries=0", () => {
      it("does not retry on 500", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse({ error: "fail" }, 500),
        );

        const client = new LangEvalsHttpClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          EvaluatorExecutionError,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
