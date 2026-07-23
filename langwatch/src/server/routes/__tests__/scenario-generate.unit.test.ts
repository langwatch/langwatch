/**
 * @vitest-environment node
 *
 * Regression for langwatch#5758. Scenario generation dispatches its LLM call
 * through the nlp-service /go/proxy gateway (the same path as the scenario
 * User-Simulator, #5760). When that gateway is broken or slow, the endpoint
 * MUST fail fast with a clean JSON envelope — never leave the request open
 * long enough for a front reverse-proxy to substitute an html 502/504 page
 * (the source of the customer's `Unexpected token '<', "<!DOCTYPE "...`).
 *
 * These tests run the REAL route handler and the REAL AI SDK retry loop (only
 * auth / rbac / model-resolution / db are stubbed), so they observe the actual
 * OUTCOME — the number of upstream attempts and the response shape — not merely
 * that an option was forwarded.
 */
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/auth")>()),
  getServerAuthSession: (...args: unknown[]) => mockGetServerAuthSession(...args),
}));

const mockHasProjectPermission = vi.fn();
vi.mock("~/server/api/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/rbac")>()),
  hasProjectPermission: (...args: unknown[]) =>
    mockHasProjectPermission(...args),
}));

const mockGetVercelAIModel = vi.fn();
vi.mock("~/server/modelProviders/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/modelProviders/utils")>()),
  getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

// Import AFTER the mocks so the route binds the stubbed dependencies.
import { app } from "../scenario-generate";

const post = (body: unknown) =>
  app.request("/api/scenario/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = {
  prompt: "A frustrated customer asking for a refund on a late order",
  currentScenario: null,
  projectId: "project_test",
};

/** A retryable gateway failure, the shape the AI SDK retries on. */
const retryableGatewayError = () =>
  new APICallError({
    message: "gateway_unavailable",
    url: "http://nlp/go/proxy/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 502,
    isRetryable: true,
  });

describe("POST /api/scenario/generate — gateway-failure resilience (#5758)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user_test" },
      expires: "1",
    });
    mockHasProjectPermission.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("given the gateway keeps returning a retryable 502", () => {
    it("bounds the dispatch to 2 attempts, not the SDK default of 3", async () => {
      let attempts = 0;
      mockGetVercelAIModel.mockResolvedValue(
        new MockLanguageModelV3({
          doGenerate: async () => {
            attempts++;
            throw retryableGatewayError();
          },
        }),
      );

      await post(validBody);

      // Falsifiable: without `maxRetries: 1` the AI SDK default (2 retries)
      // makes this 3 — which is the ~6s window that let a front proxy return
      // html in production. The fix pins it to a single retry (2 attempts).
      expect(attempts).toBe(2);
    });

    it("answers with a JSON envelope, not a thrown error or HTML", async () => {
      mockGetVercelAIModel.mockResolvedValue(
        new MockLanguageModelV3({
          doGenerate: async () => {
            throw retryableGatewayError();
          },
        }),
      );

      const res = await post(validBody);

      expect(res.headers.get("content-type")).toContain("application/json");
      const payload = (await res.json()) as { error?: string };
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(typeof payload.error).toBe("string");
    });
  });

  describe("given the gateway hangs past the abort cap", () => {
    it("aborts via a real AbortSignal.timeout and returns a fast 504 JSON message", async () => {
      // Drive a real, short abort cap (not the 30s default) against a gateway
      // that honours the AbortSignal the SDK forwards but never resolves on
      // its own — the shape of a genuinely hung upstream.
      vi.stubEnv("SCENARIO_GENERATE_TIMEOUT_MS", "80");
      mockGetVercelAIModel.mockResolvedValue(
        new MockLanguageModelV3({
          doGenerate: ({ abortSignal }) =>
            new Promise((_resolve, reject) => {
              if (abortSignal?.aborted) {
                reject(abortSignal.reason);
                return;
              }
              abortSignal?.addEventListener("abort", () =>
                reject(abortSignal.reason),
              );
            }),
        }),
      );

      const res = await post(validBody);

      // Falsifiable at the REAL seam: delete the handler's `abortSignal` and
      // this doGenerate never rejects — the request hangs and the test times
      // out. So this pins the EXISTENCE of the cap, not just an error-name ->
      // 504 mapping. It also proves a real AbortSignal.timeout reaches the
      // handler as a catchable abort (the TimeoutError name survives the SDK).
      expect(res.status).toBe(504);
      expect(res.headers.get("content-type")).toContain("application/json");
      const payload = (await res.json()) as { error?: string };
      expect(payload.error).toMatch(/too long|try again/i);
    });
  });
});
