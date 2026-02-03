import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { projectRouter } from "../project";
import { createInnerTRPCContext } from "../../trpc";
import { auditLog } from "../../../auditLog";

/**
 * Unit tests for project.regenerateApiKey mutation
 *
 * Tests the business logic of regenerating API keys:
 * - Successful key regeneration
 * - Error handling when project doesn't exist (P2025)
 * - Error handling for other Prisma errors
 */

// Mock nanoid to control API key generation
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

// Mock the permission check to always allow; use importOriginal so other rbac exports (e.g. checkPermissionOrPubliclyShared) are available to transitive imports
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

// Mock the audit log to avoid database writes
vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("project.regenerateApiKey mutation logic", () => {
  let mockPrisma: {
    project: {
      update: ReturnType<typeof vi.fn>;
    };
  };
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      project: {
        update: vi.fn(),
      },
    };

    // Create a caller with mocked context
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

    // Override prisma with our mock
    ctx.prisma = mockPrisma as unknown as PrismaClient;

    caller = projectRouter.createCaller(ctx);
  });

  describe("when project exists", () => {
    it("regenerates the API key and returns the new key", async () => {
      // Arrange
      const projectId = "project_123";
      const expectedApiKey =
        "sk-lw-mock48characterrandomstringforapikeygeneration";
      mockPrisma.project.update.mockResolvedValueOnce({
        id: projectId,
        apiKey: expectedApiKey,
        slug: "test-project",
      });

      // Act
      const result = await caller.regenerateApiKey({ projectId });

      // Assert
      expect(result).toEqual({
        apiKey: expectedApiKey,
      });
      expect(result.apiKey).toMatch(/^sk-lw-/);
      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId },
          data: {
            apiKey: expect.stringMatching(/^sk-lw-/),
          },
          select: {
            apiKey: true,
            id: true,
            slug: true,
          },
        }),
      );
    });

    it("logs the security-critical action to audit log", async () => {
      // Arrange
      const projectId = "project_123";
      mockPrisma.project.update.mockResolvedValueOnce({
        id: projectId,
        apiKey: "sk-lw-mock48characterrandomstringforapikeygeneration",
        slug: "test-project",
      });

      // Act
      await caller.regenerateApiKey({ projectId });

      // Assert - Verify audit log was called with correct parameters
      expect(auditLog).toHaveBeenCalledWith({
        action: "project.apiKey.regenerated",
        userId: "test-user-id",
        projectId: projectId,
      });
    });
  });

  describe("when project does not exist", () => {
    it("throws TRPCError with NOT_FOUND when Prisma returns P2025", async () => {
      // Arrange
      const projectId = "nonexistent_project";
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Record to update not found.",
        {
          code: "P2025",
          clientVersion: "5.0.0",
        },
      );

      mockPrisma.project.update.mockRejectedValueOnce(prismaError);

      // Act & Assert - Call actual mutation and verify it throws correct error
      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    });
  });

  describe("when Prisma throws other errors", () => {
    it("re-throws the original error for non-P2025 Prisma errors", async () => {
      // Arrange
      const projectId = "project_123";
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Connection error",
        {
          code: "P1001",
          clientVersion: "5.0.0",
        },
      );

      mockPrisma.project.update.mockRejectedValueOnce(prismaError);

      // Act & Assert - tRPC wraps non-P2025 errors as INTERNAL_SERVER_ERROR
      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Connection error",
      });
    });

    it("re-throws non-Prisma errors", async () => {
      // Arrange
      const projectId = "project_123";
      const genericError = new Error("Database connection failed");

      mockPrisma.project.update.mockRejectedValueOnce(genericError);

      // Act & Assert - tRPC wraps generic errors as INTERNAL_SERVER_ERROR
      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database connection failed",
      });
    });
  });
});
