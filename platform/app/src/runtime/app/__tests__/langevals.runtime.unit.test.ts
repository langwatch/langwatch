/**
 * @vitest-environment node
 *
 * Unit tests for AppLangevalsRuntime.
 *
 * Strategy: mock global.fetch for network I/O, vi.mock only for
 * metrics/logging (infrastructure concerns, not business logic).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EvaluatorExecutionError,
  EvaluatorInputTooLargeError,
} from "~/server/app-layer/evaluations/errors";
import { AppLangevalsRuntime, type LangevalsEvaluateParams } from "../langevals.runtime";

const { getEvaluationStatusCounter } = vi.hoisted(() => ({
  getEvaluationStatusCounter: vi.fn(() => ({ inc: vi.fn() })),
}));

vi.mock("~/server/metrics", () => ({
  evaluationDurationHistogram: {
    labels: () => ({ observe: vi.fn() }),
  },
  getEvaluationStatusCounter,
}));

vi.mock("~/server/tracer/tracesMapping", () => ({
  tryAndConvertTo: (value: unknown) => value,
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

function buildParams(overrides?: Partial<LangevalsEvaluateParams>): LangevalsEvaluateParams {
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

function createClient(endpoint: string, maxRetries = 1, timeoutMs = 120_000) {
  return AppLangevalsRuntime.create({ endpoint, maxRetries, timeoutMs });
}

describe("AppLangevalsRuntime", () => {
  const endpoint = "http://langevals:8000";

  beforeEach(() => {
    vi.useFakeTimers();
    getEvaluationStatusCounter.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses the null transport when an empty endpoint is configured", async () => {
    const client = createClient("");

    await expect(client.evaluate(buildParams())).resolves.toEqual({
      status: "skipped",
      details: "Langevals client not available",
    });
  });

  describe("evaluate()", () => {
    describe("when langevals returns a successful result", () => {
      it("returns the first result from the batch response", async () => {
        const expected = {
          status: "processed" as const,
          score: 0.95,
          passed: true,
        };
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([expected]));

        const client = createClient(endpoint);
        const result = await client.evaluate(buildParams());

        expect(result).toEqual(expected);
      });

      it("calls fetch with correct URL and body", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(jsonResponse([{ status: "processed", score: 1 }]));

        const client = createClient(endpoint);
        await client.evaluate(buildParams({ evaluatorType: "openai/moderation" }));

        expect(fetchSpy).toHaveBeenCalledWith(
          `${endpoint}/openai/moderation/evaluate`,
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      it("forwards an evaluation operation key to the provider", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(jsonResponse([{ status: "processed", score: 1 }]));

        const client = createClient(endpoint);
        await client.evaluate(buildParams({ idempotencyKey: "evaluation:retry-safe" }));

        expect(fetchSpy).toHaveBeenCalledWith(
          `${endpoint}/test/evaluator/evaluate`,
          expect.objectContaining({
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": "evaluation:retry-safe",
            },
          }),
        );
      });
    });

    describe("when fetch throws a network error", () => {
      it("throws EvaluatorExecutionError", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

        const client = createClient(endpoint);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorExecutionError);
        await expect(client.evaluate(buildParams())).rejects.toThrow("Evaluator cannot be reached");
      });
    });

    describe("when langevals returns 500 and retries are available", () => {
      it("retries and returns result on second attempt", async () => {
        const expected = { status: "processed" as const, score: 0.8 };
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(jsonResponse({ error: "internal" }, 500))
          .mockResolvedValueOnce(jsonResponse([expected]));

        const client = createClient(endpoint, 1);

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

        const client = createClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorExecutionError);
      });
    });

    describe("when langevals returns 4xx", () => {
      it("throws EvaluatorExecutionError without retrying", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(jsonResponse({ error: "bad request" }, 400));

        const client = createClient(endpoint, 2);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorExecutionError);
        // Should NOT retry on 4xx
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("when langevals returns 413", () => {
      it("throws EvaluatorInputTooLargeError without retrying", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(jsonResponse({ message: "Request Too Long" }, 413));

        const client = createClient(endpoint, 2);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorInputTooLargeError);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it("counts the outcome as skipped, not error", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse({ message: "Request Too Long" }, 413),
        );

        const client = createClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorInputTooLargeError);
        // An oversized input is the customer's payload, not a platform fault:
        // the metric label has to match the "skipped" status the command
        // ultimately emits, or dashboards read it as an error-rate spike.
        expect(getEvaluationStatusCounter).toHaveBeenCalledWith("test/evaluator", "skipped");
        expect(getEvaluationStatusCounter).not.toHaveBeenCalledWith("test/evaluator", "error");
      });
    });

    describe("when langevals returns a non-413 error status", () => {
      it("counts the outcome as error", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          jsonResponse({ error: "bad request" }, 400),
        );

        const client = createClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorExecutionError);
        expect(getEvaluationStatusCounter).toHaveBeenCalledWith("test/evaluator", "error");
      });
    });

    describe("when langevals returns empty results array", () => {
      it("throws EvaluatorExecutionError", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

        const client = createClient(endpoint);

        await expect(client.evaluate(buildParams())).rejects.toThrow(
          "Unexpected response: empty results",
        );
      });
    });

    describe("when langevals returns a malformed batch response", () => {
      it("maps the contract failure to an evaluator execution error", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ status: "processed" }));

        await expect(createClient(endpoint).evaluate(buildParams())).rejects.toThrow(
          EvaluatorExecutionError,
        );
        expect(getEvaluationStatusCounter).toHaveBeenCalledWith("test/evaluator", "error");
      });
    });

    describe("when constructed with maxRetries=0", () => {
      it("does not retry on 500", async () => {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(jsonResponse({ error: "fail" }, 500));

        const client = createClient(endpoint, 0);

        await expect(client.evaluate(buildParams())).rejects.toThrow(EvaluatorExecutionError);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
