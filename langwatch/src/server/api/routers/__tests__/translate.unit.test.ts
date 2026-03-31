import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { translateRouter } from "../translate";
import { createInnerTRPCContext } from "../../trpc";

/**
 * Unit tests for translate.translate mutation
 *
 * Verifies that:
 * - Translation uses the project's configured model provider (not hardcoded OpenAI)
 * - Error handling includes meaningful messages with the underlying cause
 */

const mockGetVercelAIModel = vi.fn();
vi.mock("../../../modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// Mock the audit log to avoid database writes
vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// Mock the permission check to always allow
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

describe("translate.translate mutation", () => {
  let caller: ReturnType<typeof translateRouter.createCaller>;
  const mockModel = { modelId: "test-model" };

  beforeEach(() => {
    vi.clearAllMocks();

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

    ctx.prisma = {} as unknown as PrismaClient;

    caller = translateRouter.createCaller(ctx);

    mockGetVercelAIModel.mockResolvedValue(mockModel);
  });

  describe("when translation succeeds", () => {
    it("calls getVercelAIModel with the correct projectId", async () => {
      const projectId = "project_abc123";
      mockGenerateText.mockResolvedValue({ text: "Hello" });

      await caller.translate({
        projectId,
        textToTranslate: "Hola",
      });

      expect(mockGetVercelAIModel).toHaveBeenCalledWith(projectId);
    });

    it("passes the resolved model to generateText", async () => {
      mockGenerateText.mockResolvedValue({ text: "Hello" });

      await caller.translate({
        projectId: "project_abc123",
        textToTranslate: "Hola",
      });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
        }),
      );
    });

    it("returns the translated text", async () => {
      mockGenerateText.mockResolvedValue({ text: "Hello world" });

      const result = await caller.translate({
        projectId: "project_abc123",
        textToTranslate: "Hola mundo",
      });

      expect(result).toEqual({ translation: "Hello world" });
    });
  });

  describe("when the model call fails", () => {
    it("throws a TRPCError with the underlying error message", async () => {
      const underlyingError = new Error("API key not configured");
      mockGenerateText.mockRejectedValue(underlyingError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: expect.stringContaining("API key not configured"),
      });
    });

    it("includes the original error as cause", async () => {
      const underlyingError = new Error("Rate limit exceeded");
      mockGenerateText.mockRejectedValue(underlyingError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        cause: underlyingError,
      });
    });

    it("uses a provider-agnostic error message", async () => {
      const underlyingError = new Error("Connection refused");
      mockGenerateText.mockRejectedValue(underlyingError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining("OpenAI"),
      });
    });
  });

  describe("when getVercelAIModel fails", () => {
    it("throws a TRPCError with the model provider error", async () => {
      const modelError = new Error(
        "Model provider openai not configured or disabled for project",
      );
      mockGetVercelAIModel.mockRejectedValue(modelError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: expect.stringContaining("not configured or disabled"),
        cause: modelError,
      });
    });
  });
});
