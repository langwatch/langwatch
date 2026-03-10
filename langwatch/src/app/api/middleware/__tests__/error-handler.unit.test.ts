import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { handleError } from "../error-handler";
import { LimitExceededError } from "~/server/license-enforcement/errors";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("handleError()", () => {
  function createTestApp(errorToThrow: Error) {
    const app = new Hono();
    app.onError(handleError);
    app.get("/", () => {
      throw errorToThrow;
    });
    return app;
  }

  describe("when error is a LimitExceededError", () => {
    it("returns 403 with structured resource limit response", async () => {
      const error = new LimitExceededError("prompts", 5, 5);
      const app = createTestApp(error);

      const res = await app.request("/");

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("ERR_RESOURCE_LIMIT");
      expect(body.message).toContain("prompts");
      expect(body.limitType).toBe("prompts");
      expect(body.current).toBe(5);
      expect(body.max).toBe(5);
    });
  });
});
