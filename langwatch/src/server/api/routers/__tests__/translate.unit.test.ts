import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelNotConfiguredError } from "../../../modelProviders/modelNotConfiguredError";
import { ModelProviderDisabledError } from "../../../modelProviders/modelProviderDisabledError";
import { createInnerTRPCContext, errorFormatterForTesting } from "../../trpc";
import { translateRouter } from "../translate";

// Regression: translate previously hardcoded openai("gpt-4-turbo"), ignoring project model config
// Regression: translate previously rewrapped every failure in a generic
// INTERNAL_SERVER_ERROR ("Check model provider configuration"), stripping
// the typed cause so the frontend could only show "please try again". It
// must now surface typed model errors so the global tRPC handler raises the
// actionable toast (missing model / provider disabled / AI call failed).

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
  const mockModel = { modelId: "gpt-5-mini" };

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

      expect(mockGetVercelAIModel).toHaveBeenCalledWith({
        projectId,
        featureKey: "translate.text",
      });
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
    it("re-raises as BAD_REQUEST and serialises a typed AI_CALL_FAILED cause the toast can read", async () => {
      mockGenerateText.mockRejectedValue(
        new Error("Invalid API key: FAKE_KEY_FOR_TESTING"),
      );

      const error = await caller
        .translate({ projectId: "project_abc123", textToTranslate: "Hola" })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      // Assert the *serialised* wire shape (error.data.cause) the frontend
      // extractor in utils/trpcError.ts::extractAiCallFailedInfo reads — not
      // the raw class property — so this fails if the formatter stops
      // emitting the field the toast consumes.
      const wire = errorFormatterForTesting({
        shape: { data: {} },
        error: error as { cause?: unknown },
      });
      expect(wire.data.cause).toMatchObject({
        code: "AI_CALL_FAILED",
        featureKey: "translate.text",
        errorMessage: expect.stringContaining("FAKE_KEY_FOR_TESTING"),
      });
    });
  });

  describe("when the model cannot be resolved", () => {
    it("propagates a typed MODEL_NOT_CONFIGURED cause to its own toast surface", async () => {
      const modelError = new ModelNotConfiguredError(
        "translate.text",
        "FAST",
        "Inline translation",
        "project_abc123",
      );
      mockGetVercelAIModel.mockRejectedValue(modelError);

      await expect(
        caller.translate({
          projectId: "project_abc123",
          textToTranslate: "Hola",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: {
          cause: "MODEL_NOT_CONFIGURED",
          featureKey: "translate.text",
        },
      });
    });

    it("propagates a typed MODEL_PROVIDER_DISABLED cause to its own toast surface", async () => {
      const modelError = new ModelProviderDisabledError(
        "translate.text",
        "Inline translation",
        "FAST",
        "project_abc123",
        "project",
        "openai/gpt-5-mini",
        "openai",
        null,
      );
      mockGetVercelAIModel.mockRejectedValue(modelError);

      const error = await caller
        .translate({ projectId: "project_abc123", textToTranslate: "Hola" })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      // Serialised wire shape the frontend extractor reads — proves the
      // typed error reaches domainErrorMiddleware untouched (the claim the
      // translate.ts comment makes) instead of being mis-tagged as an
      // AI_CALL_FAILED or flattened to a generic 500.
      const wire = errorFormatterForTesting({
        shape: { data: {} },
        error: error as { cause?: unknown },
      });
      expect(wire.data.cause).toMatchObject({
        code: "MODEL_PROVIDER_DISABLED",
        featureKey: "translate.text",
        providerKey: "openai",
      });
    });
  });
});
