import { auditLog } from "~/runtime/app/features/audit-log";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { projectRouter } from "../project";
import type { RequestAppServices } from "~/runtime/app/requestApp";

/**
 * Unit tests for project.regenerateApiKey mutation
 *
 * Tests the business logic of regenerating API keys:
 * - Successful key regeneration
 * - Error handling when the project credential doesn't exist
 * - Error handling for other API-key service errors
 */

// Mock nanoid to control API key generation
// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

// Mock the permission resolver to always allow; use importOriginal so other rbac exports stay available to transitive imports
vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    hasOrganizationPermission: vi.fn().mockResolvedValue(true),
    resolveTeamPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
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
vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("project.regenerateApiKey mutation logic", () => {
  let mockApiKeys: {
    regenerateLegacyProjectKey: ReturnType<typeof vi.fn>;
  };
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiKeys = {
      regenerateLegacyProjectKey: vi.fn(),
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
      app: { apiKeys: mockApiKeys } as unknown as RequestAppServices,
    });

    caller = projectRouter.createCaller(ctx);
  });

  describe("when project exists", () => {
    it("regenerates the API key and returns the new key", async () => {
      // Arrange
      const projectId = "project_123";
      const expectedApiKey =
        "sk-lw-mock48characterrandomstringforapikeygeneration";
      mockApiKeys.regenerateLegacyProjectKey.mockResolvedValueOnce(
        expectedApiKey,
      );

      // Act
      const result = await caller.regenerateApiKey({ projectId });

      // Assert
      expect(result).toEqual({
        apiKey: expectedApiKey,
      });
      expect(result.apiKey).toMatch(/^sk-lw-/);
      expect(mockApiKeys.regenerateLegacyProjectKey).toHaveBeenCalledWith({
        projectId,
      });
    });

    it("logs the security-critical action to audit log", async () => {
      // Arrange
      const projectId = "project_123";
      mockApiKeys.regenerateLegacyProjectKey.mockResolvedValueOnce(
        "sk-lw-mock48characterrandomstringforapikeygeneration",
      );

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
    it("throws TRPCError with NOT_FOUND when the API key service reports a missing key", async () => {
      // Arrange
      const projectId = "nonexistent_project";
      mockApiKeys.regenerateLegacyProjectKey.mockRejectedValueOnce(
        new ApiKeyNotFoundError(projectId),
      );

      // Act & Assert - Call actual mutation and verify it throws correct error
      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    });
  });

  describe("when the API key service throws other errors", () => {
    it("re-throws the original service error", async () => {
      // Arrange
      const projectId = "project_123";
      const serviceError = new Error("Connection error");
      mockApiKeys.regenerateLegacyProjectKey.mockRejectedValueOnce(serviceError);

      // Act & Assert - tRPC wraps service errors as INTERNAL_SERVER_ERROR
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

      mockApiKeys.regenerateLegacyProjectKey.mockRejectedValueOnce(genericError);

      // Act & Assert - tRPC wraps generic errors as INTERNAL_SERVER_ERROR
      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database connection failed",
      });
    });

    it("does not record the rotation as audited when the update fails", async () => {
      // When the canonical API-key service rejects, the rotation must NOT be
      // recorded as a completed action. The generic tRPC error-audit middleware still
      // fires (action: "regenerateApiKey", error: ...) — that is orthogonal
      // platform telemetry for the failed call, not a half-rotation — so we
      // assert specifically that the success-path "project.apiKey.regenerated"
      // audit was never written.
      const projectId = "project_123";
      mockApiKeys.regenerateLegacyProjectKey.mockRejectedValueOnce(
        new Error("Database connection failed"),
      );

      await expect(
        caller.regenerateApiKey({ projectId }),
      ).rejects.toBeDefined();

      expect(auditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "project.apiKey.regenerated" }),
      );
    });
  });

  describe("when the audit log fails after the key is rotated", () => {
    it("still resolves with the new key so the user is not locked out", async () => {
      // AC6: an audit failure must not prevent the caller from receiving the
      // new key. The DB write already committed; swallowing the audit error
      // and returning the key is the only safe path.
      const projectId = "project_123";
      const expectedApiKey =
        "sk-lw-mock48characterrandomstringforapikeygeneration";
      mockApiKeys.regenerateLegacyProjectKey.mockResolvedValueOnce(
        expectedApiKey,
      );
      vi.mocked(auditLog).mockRejectedValueOnce(
        new Error("audit service unavailable"),
      );

      const result = await caller.regenerateApiKey({ projectId });

      expect(result).toEqual({ apiKey: expectedApiKey });
    });
  });
});
