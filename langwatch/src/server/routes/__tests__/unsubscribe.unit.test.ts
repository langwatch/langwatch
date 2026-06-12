import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getApp } from "~/server/app-layer/app";
import { InvalidUnsubscribeTokenError } from "~/server/app-layer/triggers/emailSuppression.service";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { app } from "../unsubscribe";

// Transport-mapping test only: the unsubscribe behaviour itself (token
// verification, scope handling, persistence) is owned and tested by
// EmailSuppressionService — here the service is a mock and the assertions
// are about HTTP semantics (status codes, Allow header, rate limit).
const confirmUnsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryRateLimitStore();
  confirmUnsubscribe.mockResolvedValue(undefined);
  (getApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    emailSuppressions: { confirmUnsubscribe },
  });
});

function request({
  method = "POST",
  token,
}: {
  method?: string;
  token?: string;
}) {
  const url =
    token != null
      ? `/api/unsubscribe?token=${encodeURIComponent(token)}`
      : "/api/unsubscribe";
  return app.request(url, { method });
}

describe("POST /api/unsubscribe (one-click)", () => {
  describe("when the method is not POST", () => {
    it("rejects with 405 and an Allow header", async () => {
      const res = await request({ method: "GET", token: "anything" });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(confirmUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("when the token query param is missing", () => {
    it("rejects with 400 without calling the service", async () => {
      const res = await request({});
      expect(res.status).toBe(400);
      expect(confirmUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe("when the service rejects the token as invalid", () => {
    it("maps InvalidUnsubscribeTokenError to 400", async () => {
      confirmUnsubscribe.mockRejectedValue(new InvalidUnsubscribeTokenError());
      const res = await request({ token: "garbage.sig" });
      expect(res.status).toBe(400);
    });
  });

  describe("when the service confirms the unsubscribe", () => {
    it("returns 200 and delegates trigger-scoped", async () => {
      const res = await request({ token: "valid-token" });
      expect(res.status).toBe(200);
      expect(confirmUnsubscribe).toHaveBeenCalledWith({
        token: "valid-token",
        scope: "trigger",
      });
    });
  });

  describe("when the service fails for any other reason", () => {
    it("returns 500 rather than masking the failure as an invalid link", async () => {
      confirmUnsubscribe.mockRejectedValue(new Error("db down"));
      const res = await request({ token: "valid-token" });
      expect(res.status).toBe(500);
    });
  });

  describe("when the caller exceeds the rate limit", () => {
    it("returns 429 once the per-IP window is exhausted", async () => {
      const headers = { "x-forwarded-for": "203.0.113.7" };

      // The limiter allows 10 requests per 60s window; the 11th is rejected.
      for (let i = 0; i < 10; i++) {
        const ok = await app.request("/api/unsubscribe?token=t", {
          method: "POST",
          headers,
        });
        expect(ok.status).toBe(200);
      }

      const limited = await app.request("/api/unsubscribe?token=t", {
        method: "POST",
        headers,
      });
      expect(limited.status).toBe(429);
      expect(confirmUnsubscribe).toHaveBeenCalledTimes(10);
    });
  });
});
