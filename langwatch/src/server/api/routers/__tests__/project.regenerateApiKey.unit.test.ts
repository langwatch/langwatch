import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { projectRouter, generateApiKey } from "../project";

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

// Mock the permission check to always allow
vi.mock("../../rbac", () => ({
  hasProjectPermission: vi.fn(() => Promise.resolve(true)),
  checkProjectPermission: () => async ({ ctx, next }: any) => {
    ctx.permissionChecked = true;
    return next();
  },
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
    const ctx = {
      session: {
        user: { id: "test-user-id" },
        expires: "1",
      },
      prisma: mockPrisma as unknown as PrismaClient,
      permissionChecked: true,
      publiclyShared: false,
    };

    caller = projectRouter.createCaller(ctx);
  });

  describe("when project exists", () => {
    it("generates a new API key with correct format", async () => {
      // Arrange
      const projectId = "project_123";
      mockPrisma.project.update.mockResolvedValueOnce({
        id: projectId,
        apiKey: "sk-lw-mock48characterrandomstringforapikeygeneration",
        slug: "test-project",
      });

      // Act
      const result = await caller.regenerateApiKey({ projectId });

      // Assert
      expect(result.success).toBe(true);
      expect(result.apiKey).toMatch(/^sk-lw-/);
      expect(result.apiKey).toBe(
        "sk-lw-mock48characterrandomstringforapikeygeneration",
      );
    });

    it("calls prisma.project.update with the new API key", async () => {
      // Arrange
      const projectId = "project_123";
      mockPrisma.project.update.mockResolvedValueOnce({
        id: projectId,
        apiKey: "sk-lw-mock48characterrandomstringforapikeygeneration",
        slug: "test-project",
      });

      // Act
      await caller.regenerateApiKey({ projectId });

      // Assert
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

    it("returns success with the new API key", async () => {
      // Arrange
      const projectId = "project_123";
      const expectedApiKey = "sk-lw-mock48characterrandomstringforapikeygeneration";

      mockPrisma.project.update.mockResolvedValueOnce({
        id: projectId,
        apiKey: expectedApiKey,
        slug: "test-project",
      });

      // Act
      const result = await caller.regenerateApiKey({ projectId });

      // Assert
      expect(result).toEqual({
        success: true,
        apiKey: expectedApiKey,
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

  describe("API key generation format", () => {
    // These tests use the real nanoid to validate actual generation
    beforeEach(async () => {
      // Restore real nanoid for format/length tests
      vi.unmock("nanoid");
    });

    it("generates keys with correct format (sk-lw-*)", () => {
      // Call the actual generateApiKey function with real nanoid
      const generatedKey = generateApiKey();

      expect(generatedKey).toMatch(/^sk-lw-/);
    });

    it("generates keys with correct length", () => {
      // Call the actual generateApiKey function with real nanoid
      const generatedKey = generateApiKey();

      expect(generatedKey.length).toBe(54); // "sk-lw-" (6) + 48 characters
    });
  });
});
