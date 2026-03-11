import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { Hono } from "hono";
import { resourceLimitMiddleware } from "../resource-limit";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import type { LimitType } from "~/server/license-enforcement/types";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    team: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/server/license-enforcement", () => ({
  createLicenseEnforcementService: vi.fn(),
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
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { getApp } from "~/server/app-layer/app";
import { env } from "~/env.mjs";

describe("resourceLimitMiddleware()", () => {
  let mockEnforceLimit: Mock;
  let mockGetActivePlan: Mock;
  let mockNotifyPlanLimitReached: Mock;

  const project = {
    id: "project-123",
    teamId: "team-456",
    apiKey: "test-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnforceLimit = vi.fn().mockResolvedValue(undefined);
    (createLicenseEnforcementService as Mock).mockReturnValue({
      enforceLimit: mockEnforceLimit,
    });

    (prisma.team.findUnique as Mock).mockResolvedValue({
      id: "team-456",
      organizationId: "org-789",
    });

    mockGetActivePlan = vi.fn().mockResolvedValue({
      name: "free",
      planSource: "free" as const,
    });

    mockNotifyPlanLimitReached = vi.fn().mockResolvedValue(undefined);

    (getApp as Mock).mockReturnValue({
      planProvider: {
        getActivePlan: mockGetActivePlan,
      },
      usageLimits: {
        notifyPlanLimitReached: mockNotifyPlanLimitReached,
      },
    });
  });

  function createTestApp(limitType: LimitType) {
    const app = new Hono();
    // Simulate authMiddleware setting project
    app.use("/*", async (c, next) => {
      c.set("project" as never, project);
      await next();
    });
    app.use("/*", resourceLimitMiddleware(limitType));
    app.post("/", (c) => c.json({ created: true }));
    return app;
  }

  describe("when limit is not exceeded", () => {
    it("allows the request through", async () => {
      const app = createTestApp("prompts");
      const res = await app.request("/", { method: "POST" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ created: true });
    });

    it("calls enforceLimit with the resolved organizationId", async () => {
      const app = createTestApp("evaluators");
      await app.request("/", { method: "POST" });

      expect(prisma.team.findUnique).toHaveBeenCalledWith({
        where: { id: "team-456" },
        select: { organizationId: true },
      });
      expect(mockEnforceLimit).toHaveBeenCalledWith("org-789", "evaluators");
    });
  });

  describe("when limit is exceeded", () => {
    beforeEach(() => {
      mockEnforceLimit.mockRejectedValue(
        new LimitExceededError("prompts", 5, 5),
      );
    });

    it("returns 403 with structured error response", async () => {
      const app = createTestApp("prompts");
      const res = await app.request("/", { method: "POST" });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("resource_limit_exceeded");
      expect(body.limitType).toBe("prompts");
      expect(body.current).toBe(5);
      expect(body.max).toBe(5);
      expect(body.message).toBeDefined();
    });

    it("fires notification asynchronously", async () => {
      const app = createTestApp("prompts");
      await app.request("/", { method: "POST" });

      await vi.waitFor(() =>
        expect(mockNotifyPlanLimitReached).toHaveBeenCalledWith({
          organizationId: "org-789",
          planName: "free",
        }),
      );
    });
  });

  describe("when organization cannot be resolved", () => {
    beforeEach(() => {
      (prisma.team.findUnique as Mock).mockResolvedValue(null);
    });

    it("returns 500", async () => {
      const app = createTestApp("prompts");
      const res = await app.request("/", { method: "POST" });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Internal Server Error");
    });
  });

  describe("customer-facing messages", () => {
    beforeEach(() => {
      mockEnforceLimit.mockRejectedValue(
        new LimitExceededError("prompts", 5, 5),
      );
    });

    describe("when on free SaaS plan", () => {
      beforeEach(() => {
        (env as any).IS_SAAS = true;
        mockGetActivePlan.mockResolvedValue({
          name: "free",
          planSource: "free" as const,
        });
      });

      it("tells user to upgrade plan at SaaS URL", async () => {
        const app = createTestApp("prompts");
        const res = await app.request("/", { method: "POST" });
        const body = await res.json();

        expect(body.message).toContain("Free plan limit of 5 prompts reached");
        expect(body.message).toContain(
          "upgrade your plan at https://app.langwatch.ai/settings/subscription",
        );
      });
    });

    describe("when on paid SaaS subscription", () => {
      beforeEach(() => {
        (env as any).IS_SAAS = true;
        mockGetActivePlan.mockResolvedValue({
          name: "pro",
          planSource: "subscription" as const,
        });
      });

      it("tells user to upgrade plan at SaaS URL", async () => {
        const app = createTestApp("prompts");
        const res = await app.request("/", { method: "POST" });
        const body = await res.json();

        expect(body.message).toContain("Plan limit of 5 prompts reached");
        expect(body.message).toContain(
          "upgrade your plan at https://app.langwatch.ai/settings/subscription",
        );
      });
    });

    describe("when self-hosted without license", () => {
      beforeEach(() => {
        (env as any).IS_SAAS = false;
        (env as any).BASE_HOST = "https://my-instance.example.com";
        mockGetActivePlan.mockResolvedValue({
          name: "free",
          planSource: "free" as const,
        });
      });

      it("tells user to get a license", async () => {
        const app = createTestApp("prompts");
        const res = await app.request("/", { method: "POST" });
        const body = await res.json();

        expect(body.message).toContain("Free plan limit of 5 prompts reached");
        expect(body.message).toContain(
          "get a license at https://my-instance.example.com/settings/license",
        );
      });
    });

    describe("when self-hosted with license", () => {
      beforeEach(() => {
        (env as any).IS_SAAS = false;
        (env as any).BASE_HOST = "https://my-instance.example.com";
        mockGetActivePlan.mockResolvedValue({
          name: "enterprise",
          planSource: "license" as const,
        });
      });

      it("tells user to upgrade license", async () => {
        const app = createTestApp("prompts");
        const res = await app.request("/", { method: "POST" });
        const body = await res.json();

        expect(body.message).toContain(
          "License limit of 5 prompts reached",
        );
        expect(body.message).toContain(
          "upgrade your license at https://my-instance.example.com/settings/license",
        );
      });
    });
  });

  describe("when notification fails", () => {
    beforeEach(() => {
      mockEnforceLimit.mockRejectedValue(
        new LimitExceededError("prompts", 5, 5),
      );
      mockNotifyPlanLimitReached.mockRejectedValue(
        new Error("Slack failed"),
      );
    });

    it("still returns 403 (notification is non-blocking)", async () => {
      const app = createTestApp("prompts");
      const res = await app.request("/", { method: "POST" });

      expect(res.status).toBe(403);
    });
  });

  describe("when organizationMiddleware has already resolved organization", () => {
    function createTestAppWithOrganization(limitType: LimitType) {
      const app = new Hono();
      // Simulate authMiddleware + organizationMiddleware setting both project and organization
      app.use("/*", async (c, next) => {
        c.set("project" as never, project);
        c.set("organization" as never, { id: "org-cached" });
        await next();
      });
      app.use("/*", resourceLimitMiddleware(limitType));
      app.post("/", (c) => c.json({ created: true }));
      return app;
    }

    it("uses cached organizationId and skips DB query", async () => {
      const app = createTestAppWithOrganization("prompts");
      await app.request("/", { method: "POST" });

      expect(prisma.team.findUnique).not.toHaveBeenCalled();
      expect(mockEnforceLimit).toHaveBeenCalledWith("org-cached", "prompts");
    });
  });
});
