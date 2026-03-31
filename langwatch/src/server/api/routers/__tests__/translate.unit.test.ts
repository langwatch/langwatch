import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { translateRouter } from "../translate";
import { createInnerTRPCContext } from "../../trpc";

// Regression: translate previously hardcoded openai("gpt-4-turbo"), ignoring project model config

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

type MiddlewareParams = {
  ctx: Record<string, unknown>;
  next: () => Promise<unknown>;
};

// Mock the permission check to always allow
vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: MiddlewareParams) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: MiddlewareParams) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkTeamPermission:
      () =>
      async ({ ctx, next }: MiddlewareParams) => {
        ctx.permissionChecked = true;
        return next();
      },
    skipPermissionCheck: ({ ctx, next }: MiddlewareParams) => {
      ctx.permissionChecked = true;
      return next();
    },
    skipPermissionCheckProjectCreation: ({ ctx, next }: MiddlewareParams) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

describe("translateRouter.translate()", () => {
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
    it("throws a TRPCError with a generic message that hides upstream details", async () => {
      const underlyingError = new Error("Invalid API key: sk-proj-abc123");
      mockGenerateText.mockRejectedValue(underlyingError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Failed to get translation. Check model provider configuration.",
      });
    });

    it("does not leak the upstream error message to the client", async () => {
      const underlyingError = new Error("Invalid API key: sk-proj-abc123");
      mockGenerateText.mockRejectedValue(underlyingError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining("sk-proj-abc123"),
      });
    });

    it("includes the original error as cause for server-side debugging", async () => {
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
  });

  describe("when getVercelAIModel fails", () => {
    it("throws a TRPCError with a generic message and preserves cause", async () => {
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
        message:
          "Failed to get translation. Check model provider configuration.",
        cause: modelError,
      });
    });
  });
});
