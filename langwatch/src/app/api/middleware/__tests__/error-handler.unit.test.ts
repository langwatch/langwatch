import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { Hono } from "hono";
import { handleError } from "../error-handler";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { ERR_RESOURCE_LIMIT } from "~/server/license-enforcement/constants";

vi.mock("~/server/db", () => ({
  prisma: {
    team: {
      findUnique: vi.fn(),
    },
  },
}));

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

import { prisma } from "~/server/db";
import { getApp } from "~/server/app-layer/app";

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

  function createTestAppWithProject(errorToThrow: Error) {
    const app = new Hono();
    app.onError(handleError);
    app.use("/*", async (c, next) => {
      c.set("project", { id: "project-123", teamId: "team-456" });
      await next();
    });
    app.get("/", () => {
      throw errorToThrow;
    });
    return app;
  }

  describe("when error is a LimitExceededError", () => {
    describe("when organizationId can be resolved from project", () => {
      beforeEach(() => {
        (prisma.team.findUnique as Mock).mockResolvedValue({
          id: "team-456",
          organizationId: "org-789",
        });

        (getApp as Mock).mockReturnValue({
          planProvider: {
            getActivePlan: vi.fn().mockResolvedValue({
              name: "free",
              planSource: "free" as const,
            }),
          },
        });
      });

      it("returns 403 with upgrade guidance in message", async () => {
        const error = new LimitExceededError("prompts", 5, 5);
        const app = createTestAppWithProject(error);

        const res = await app.request("/");

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe(ERR_RESOURCE_LIMIT);
        expect(body.message).toContain("Free plan limit of 5 prompts reached");
        expect(body.message).toContain("get a license at");
        expect(body.limitType).toBe("prompts");
        expect(body.current).toBe(5);
        expect(body.max).toBe(5);
      });
    });

    describe("when organizationId cannot be resolved", () => {
      it("falls back to generic error message", async () => {
        const error = new LimitExceededError("prompts", 5, 5);
        const app = createTestApp(error);

        const res = await app.request("/");

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe(ERR_RESOURCE_LIMIT);
        expect(body.message).toContain("prompts");
        expect(body.limitType).toBe("prompts");
        expect(body.current).toBe(5);
        expect(body.max).toBe(5);
      });
    });
  });
});
