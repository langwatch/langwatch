import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { handleError } from "../error-handler";
import { LimitExceededError } from "~/server/license-enforcement/errors";

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    BASE_HOST: "https://my-instance.example.com",
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("handleError()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createTestApp(errorToThrow: Error) {
    const app = new Hono();
    app.onError(handleError);
    app.get("/", () => {
      throw errorToThrow;
    });
    return app;
  }

  describe("when error is a LimitExceededError", () => {
    it("returns 403 with DomainError shape", async () => {
      const error = new LimitExceededError("prompts", 5, 5);
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("resource_limit_exceeded");
      expect(body.message).toBe(
        "You have reached the maximum number of prompts",
      );
    });

    it("does not include limitType, current, or max in response body", async () => {
      const error = new LimitExceededError("prompts", 5, 5);
      const app = createTestApp(error);

      const res = await app.request("/");

      const body = await res.json();
      expect(body).not.toHaveProperty("limitType");
      expect(body).not.toHaveProperty("current");
      expect(body).not.toHaveProperty("max");
    });
  });
});
