import { createMocks } from "node-mocks-http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";

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
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { signUnsubscribeToken } from "~/server/mailer/unsubscribeToken";
import handler from "../unsubscribe";

const suppress = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryRateLimitStore();
  suppress.mockResolvedValue(undefined);
  (getApp as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    emailSuppressions: { suppress },
  });
});

function invoke({
  method = "POST",
  token,
}: {
  method?: string;
  token?: string;
}) {
  const { req, res } = createMocks({
    method,
    query: token != null ? { token } : {},
  });
  return { req, res };
}

describe("one-click unsubscribe handler", () => {
  describe("when the method is not POST", () => {
    it("rejects with 405 and an Allow header", async () => {
      const { req, res } = invoke({ method: "GET", token: "anything" });
      await handler(
        req as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res._getStatusCode()).toBe(405);
      expect(res.getHeader("Allow")).toBe("POST");
      expect(suppress).not.toHaveBeenCalled();
    });
  });

  describe("when the token query param is missing", () => {
    it("rejects with 400", async () => {
      const { req, res } = invoke({});
      await handler(
        req as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res._getStatusCode()).toBe(400);
      expect(suppress).not.toHaveBeenCalled();
    });
  });

  describe("when the token is invalid or tampered", () => {
    it("rejects with 400 without persisting", async () => {
      const { req, res } = invoke({ token: "garbage.sig" });
      await handler(
        req as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res._getStatusCode()).toBe(400);
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
      const { req, res } = invoke({ token });
      await handler(
        req as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res._getStatusCode()).toBe(200);
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
      const { req, res } = invoke({ token });
      await handler(
        req as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res._getStatusCode()).toBe(500);
    });
  });
});
