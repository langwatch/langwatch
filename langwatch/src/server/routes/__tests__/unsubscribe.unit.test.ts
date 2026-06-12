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
import { signUnsubscribeToken } from "~/server/mailer/unsubscribeToken";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { app } from "../unsubscribe";

const suppress = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryRateLimitStore();
  suppress.mockResolvedValue(undefined);
  (getApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    emailSuppressions: { suppress },
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
      expect(suppress).not.toHaveBeenCalled();
    });
  });

  describe("when the token query param is missing", () => {
    it("rejects with 400", async () => {
      const res = await request({});
      expect(res.status).toBe(400);
      expect(suppress).not.toHaveBeenCalled();
    });
  });

  describe("when the token is invalid or tampered", () => {
    it("rejects with 400 without persisting", async () => {
      const res = await request({ token: "garbage.sig" });
      expect(res.status).toBe(400);
      expect(suppress).not.toHaveBeenCalled();
    });
  });

  describe("when the token is valid", () => {
    it("suppresses the trigger-scoped recipient and returns 200", async () => {
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      const res = await request({ token });
      expect(res.status).toBe(200);
      expect(suppress).toHaveBeenCalledWith({
        projectId: "p1",
        email: "alice@example.com",
        triggerId: "t1",
        reason: "unsubscribe",
      });
    });
  });

  describe("when persistence fails on a valid token", () => {
    it("returns 500 rather than masking the DB error as an invalid link", async () => {
      suppress.mockRejectedValue(new Error("db down"));
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      const res = await request({ token });
      expect(res.status).toBe(500);
    });
  });

  describe("when the caller exceeds the rate limit", () => {
    it("returns 429 once the per-IP window is exhausted", async () => {
      const token = signUnsubscribeToken({
        projectId: "p1",
        triggerId: "t1",
        email: "alice@example.com",
      });
      const headers = { "x-forwarded-for": "203.0.113.7" };

      // The limiter allows 10 requests per 60s window; the 11th is rejected.
      for (let i = 0; i < 10; i++) {
        const ok = await app.request(
          `/api/unsubscribe?token=${encodeURIComponent(token)}`,
          { method: "POST", headers },
        );
        expect(ok.status).toBe(200);
      }

      const limited = await app.request(
        `/api/unsubscribe?token=${encodeURIComponent(token)}`,
        { method: "POST", headers },
      );
      expect(limited.status).toBe(429);
    });
  });
});
