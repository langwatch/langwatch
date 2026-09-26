import { beforeEach, describe, expect, it, vi } from "vitest";

const { findTeamMemberBindings, GrantsAccessListingRepository } = vi.hoisted(
  () => {
    const findTeamMemberBindings = vi.fn();
    const GrantsAccessListingRepository = vi.fn(function () {
      return { findTeamMemberBindings };
    });
    return { findTeamMemberBindings, GrantsAccessListingRepository };
  },
);

vi.mock(
  "~/server/app-layer/authz/repositories/access-listing.grants.repository",
  () => ({
    GrantsAccessListingRepository,
  }),
);

vi.mock("~/server/db", () => ({
  prisma: {
    projectSecret: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-value"),
}));

vi.mock("~/utils/extend-zod-openapi", () => ({
  patchZodOpenapi: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
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
    requirePermission: () => async (_c: any, next: any) => {
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

// The SecuredApp project strategy imports authMiddleware/requirePermission from
// the auth module directly, so mock that path (not just the barrel) to inject a
// project and bypass real auth in this unit test.
vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set("project", {
        id: "project-1",
        teamId: "team-1",
        name: "Test Project",
      });
      await next();
    },
    requirePermission: () => async (_c: any, next: any) => {
      await next();
    },
  };
});

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
    (prisma.team as any).findUnique.mockResolvedValue({
      organizationId: "org-1",
    });
  });

  describe("when team has canonical grant users", () => {
    beforeEach(() => {
      findTeamMemberBindings.mockResolvedValue(
        new Map([["team-1", [{ userId: "user-grants-only" }]]]),
      );
    });

    it("queries the canonical team-member listing for fallback owner", async () => {
      const res = await app.request("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "MY_SECRET",
          value: "secret-value",
        }),
      });

      expect(res.status).toBe(201);
      expect(findTeamMemberBindings).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamIds: ["team-1"],
      });
    });

    it("uses the canonical grant userId as secret owner", async () => {
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
            createdById: "user-grants-only",
            updatedById: "user-grants-only",
          }),
        }),
      );
    });
  });

  describe("when no canonical team members exist for the team", () => {
    beforeEach(() => {
      findTeamMemberBindings.mockResolvedValue(new Map([["team-1", []]]));
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
        }),
      );
    });
  });
});
