import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warn, debug } = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, debug, info: vi.fn(), error: vi.fn() }),
}));

import { shadowUserPermissionCheck } from "../shadow";

function makePrisma({ throwOnProject = false } = {}) {
  return {
    project: {
      findUnique: throwOnProject
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue({
            team: { id: "team-1", organizationId: "org-1" },
          }),
    },
    organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    teamUser: { findMany: vi.fn().mockResolvedValue([]) },
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("authz shadow mode", () => {
  const originalFlag = process.env.AUTHZ_V2_SHADOW;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTHZ_V2_SHADOW = "1";
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTHZ_V2_SHADOW;
    else process.env.AUTHZ_V2_SHADOW = originalFlag;
  });

  describe("given the flag is off", () => {
    it("does nothing at all", async () => {
      delete process.env.AUTHZ_V2_SHADOW;
      const prisma = makePrisma();

      shadowUserPermissionCheck({
        prisma: prisma as unknown as PrismaClient,
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "test",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(prisma.project.findUnique).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when legacy and engine disagree", () => {
    it("logs one structured mismatch and never throws", async () => {
      const prisma = makePrisma();

      // Engine will deny (no membership, no bindings); legacy said yes.
      shadowUserPermissionCheck({
        prisma: prisma as unknown as PrismaClient,
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: "trpc.project",
          legacyAllowed: true,
          engineAllowed: false,
          permission: "traces:view",
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("when legacy and engine agree", () => {
    it("stays silent", async () => {
      const prisma = makePrisma();

      shadowUserPermissionCheck({
        prisma: prisma as unknown as PrismaClient,
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: false,
        projectId: "proj-1",
        caller: "trpc.project",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when the comparison itself blows up", () => {
    it("swallows the error at debug level", async () => {
      const prisma = makePrisma({ throwOnProject: true });

      shadowUserPermissionCheck({
        prisma: prisma as unknown as PrismaClient,
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-1",
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(debug).toHaveBeenCalled());
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
