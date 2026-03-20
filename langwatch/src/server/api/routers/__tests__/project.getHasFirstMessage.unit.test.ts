import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { projectRouter } from "../project";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkTeamPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
    skipPermissionCheckProjectCreation: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("project.getHasFirstMessage", () => {
  let mockPrisma: {
    project: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      project: {
        findUnique: vi.fn(),
      },
    };

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "test-user-id" },
        expires: "1",
      },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });

    ctx.prisma = mockPrisma as unknown as PrismaClient;
    caller = projectRouter.createCaller(ctx);
  });

  describe("when project has received traces", () => {
    it("returns firstMessage as true", async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        firstMessage: true,
      });

      const result = await caller.getHasFirstMessage({
        projectId: "project_123",
      });

      expect(result).toEqual({ firstMessage: true });
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: "project_123" },
        select: { firstMessage: true },
      });
    });
  });

  describe("when project has not received traces", () => {
    it("returns firstMessage as false", async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({
        firstMessage: false,
      });

      const result = await caller.getHasFirstMessage({
        projectId: "project_123",
      });

      expect(result).toEqual({ firstMessage: false });
    });
  });

  describe("when project does not exist", () => {
    it("returns firstMessage as false", async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce(null);

      const result = await caller.getHasFirstMessage({
        projectId: "nonexistent",
      });

      expect(result).toEqual({ firstMessage: false });
    });
  });
});
