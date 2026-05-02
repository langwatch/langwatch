import { RoleBindingScopeType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({
  prisma: {
    projectSecret: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    roleBinding: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-value"),
}));

vi.mock("~/utils/extend-zod-openapi", () => ({
  patchZodOpenapi: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../middleware", async () => {
  return {
    authMiddleware: async (c: any, next: any) => {
      c.set("project", {
        id: "project-1",
        teamId: "team-1",
        name: "Test Project",
      });
      await next();
    },
    handleError: (err: any, c: any) => {
      return c.json({ error: err.message }, 500);
    },
  };
});

vi.mock("../../middleware/logger", () => ({
  loggerMiddleware: () => async (_c: any, next: any) => {
    await next();
  },
}));

vi.mock("../../middleware/tracer", () => ({
  tracerMiddleware: () => async (_c: any, next: any) => {
    await next();
  },
}));

import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("secrets API fallback owner lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (prisma.projectSecret.count as any).mockResolvedValue(0);
    (prisma.projectSecret.findFirst as any).mockResolvedValue(null);
    (prisma.projectSecret.create as any).mockResolvedValue({
      id: "secret-1",
      projectId: "project-1",
      name: "MY_SECRET",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
  });

  describe("when team has only RoleBinding users (no TeamUser rows)", () => {
    beforeEach(() => {
      (prisma.roleBinding.findFirst as any).mockResolvedValue({
        userId: "user-rolebinding-only",
      });
    });

    it("queries roleBinding with team scope for fallback owner", async () => {
      const res = await app.request("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "MY_SECRET",
          value: "secret-value",
        }),
      });

      expect(res.status).toBe(201);
      expect(prisma.roleBinding.findFirst).toHaveBeenCalledWith({
        where: {
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
          userId: { not: null },
        },
        select: { userId: true },
      });
    });

    it("uses the roleBinding userId as secret owner", async () => {
      await app.request("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "MY_SECRET",
          value: "secret-value",
        }),
      });

      expect(prisma.projectSecret.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "user-rolebinding-only",
            updatedById: "user-rolebinding-only",
          }),
        })
      );
    });
  });

  describe("when no RoleBinding users exist for the team", () => {
    beforeEach(() => {
      (prisma.roleBinding.findFirst as any).mockResolvedValue(null);
    });

    it("falls back to system as owner", async () => {
      await app.request("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "MY_SECRET",
          value: "secret-value",
        }),
      });

      expect(prisma.projectSecret.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "system",
            updatedById: "system",
          }),
        })
      );
    });
  });
});
