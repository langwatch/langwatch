import { describe, expect, it, vi } from "vitest";

/**
 * Reproduces the production defect where a single `/api` request emitted
 * 12-13 `request handled` lines and the same number of nested `GET api`
 * spans — same pod, same pid, same URL, distinct span ids.
 *
 * Drives the REAL composed router rather than a synthetic stand-in: a
 * hand-built Hono router with the same shape does NOT reproduce it, so the
 * cause lives somewhere in the real composition.
 */
const logHttpRequest = vi.fn();

vi.mock("@langwatch/observability/request", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  logHttpRequest: (...args: unknown[]) => logHttpRequest(...args),
}));

describe("given the real composed API router", () => {
  describe("when a single request is dispatched to it", () => {
    it("logs that request exactly once", async () => {
      const { createApiRouter } = await import("~/server/api-router");
      const api = createApiRouter();
      logHttpRequest.mockClear();

      await api.request("http://localhost/api/health");

      const urls = logHttpRequest.mock.calls.map(
        (call) => (call[1] as { url?: string })?.url,
      );
      expect(
        logHttpRequest.mock.calls.length,
        `request handled logged ${logHttpRequest.mock.calls.length}x for one request: ${JSON.stringify(urls)}`,
      ).toBe(1);
    });
  });
});
