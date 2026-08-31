import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { ModelProviderDisabledError } from "../../../modelProviders/modelProviderDisabledError";
import { createTranslateTrpcRouter, declaredCheckFrom } from "@langwatch/platform-api/app-trpc";
import { wrapAiCall } from "../../../modelProviders/aiCallFailedError";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "../../../app-layer/authz/trpc-middleware";
import { createInnerTRPCContext, errorFormatter } from "../../trpc";
import { appTrpcRoot } from "../../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../../trpc.runtime-policy";
import { scopeLineageGuard } from "../../trpc.scope-lineage-middleware";

/**
 * The transport is package-owned, so the test mounts it the way the process
 * does — the same middleware chain, in the same order — rather than importing
 * a router that no longer exists in this application.
 */
const translateRouter = createTranslateTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares: {
    tracer: tracerMiddleware,
    logger: loggerMiddleware,
    handledError: handledErrorMiddleware,
    scopeLineageGuard,
    declaredCheck: declaredCheckFrom({
      permission: checkDeclaredPermission,
      permissionAny: checkDeclaredPermissionAny,
      noPermission: declaredNoPermission,
      serviceAuthorized: declaredServiceAuthorization,
    }),
    enforceCheck: enforcePermissionCheck,
    auditMutations: auditLogMutations,
  },
  ports: { wrapAiCall },
});

// Regression: translate previously rewrapped every failure in a generic
// INTERNAL_SERVER_ERROR ("Check model provider configuration"), stripping
// the typed cause so the frontend could only show "please try again". It
// must now surface typed model errors so the global tRPC handler raises the
// actionable toast (missing model / provider disabled / AI call failed).
//
// Which model answers is resolved BELOW this transport: the procedure hands
// the request to `app.modelProviders.translate`, and the application resolves
// the project's configured `translate.text` model from there. So the double
// below stands at that seam rather than at the SDK, which the transport no
// longer reaches at all.
const mockTranslate = vi.fn();

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

// Mock the audit log to avoid database writes
vi.mock("~/runtime/app/features/audit-log", () => ({
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
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    resolveTeamPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    hasOrganizationPermission: vi.fn().mockResolvedValue(true),
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
    Object.assign(ctx.app, { modelProviders: { translate: mockTranslate } });

    caller = translateRouter.createCaller(ctx);

    mockTranslate.mockResolvedValue({ translation: "Hello" });
  });

  describe("when translation succeeds", () => {
    it("hands the caller's own project to the application", async () => {
      const projectId = "project_abc123";

      await caller.translate({
        projectId,
        textToTranslate: "Hola",
      });

      // The project travels, which is what makes the answer come from THAT
      // project's configured model rather than a model named in this file.
      expect(mockTranslate).toHaveBeenCalledWith({
        projectId,
        text: "Hola",
      });
    });

    it("returns the translated text", async () => {
      mockTranslate.mockResolvedValue({ translation: "Hello world" });

      const result = await caller.translate({
        projectId: "project_abc123",
        textToTranslate: "Hola mundo",
      });

      expect(result).toEqual({ translation: "Hello world" });
    });
  });

  describe("when the model call fails", () => {
    it("re-raises as BAD_REQUEST and serialises a typed AI_CALL_FAILED cause the toast can read", async () => {
      mockTranslate.mockRejectedValue(new Error("Invalid API key: FAKE_KEY_FOR_TESTING"));

      const error = await caller
        .translate({ projectId: "project_abc123", textToTranslate: "Hola" })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      // Assert the *serialised* wire shape (error.data.cause) the frontend
      // extractor in utils/trpcError.ts::extractAiCallFailedInfo reads — not
      // the raw class property — so this fails if the formatter stops
      // emitting the fields the toast consumes.
      const wire = errorFormatter({
        shape: { data: {} },
        error: error as { cause?: unknown },
      });
      expect(wire.data.cause).toMatchObject({
        code: "AI_CALL_FAILED",
        featureKey: "translate.text",
      });
    });

    it("keeps the provider's own text off the wire", async () => {
      // The provider's response body routinely echoes credential material —
      // an OpenAI 401 body is literally `Incorrect API key provided: sk-proj-…`
      // — and when the call used a LangWatch-managed provider that key is
      // ours, not the customer's. An earlier version of this test asserted the
      // opposite, which is how the leak survived review.
      mockTranslate.mockRejectedValue(new Error("Invalid API key: FAKE_KEY_FOR_TESTING"));

      const error = await caller
        .translate({ projectId: "project_abc123", textToTranslate: "Hola" })
        .then(() => null)
        .catch((e: unknown) => e);

      const wire = errorFormatter({
        shape: { data: {} },
        error: error as { cause?: unknown },
      });

      expect(JSON.stringify(wire)).not.toContain("FAKE_KEY_FOR_TESTING");
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
      mockTranslate.mockRejectedValue(modelError);

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

    /**
     * KNOWN GAP, pinned as it behaves rather than as it should.
     *
     * `wrapAiCall` lets `ModelNotConfiguredError` through and re-raises
     * everything else as `ai_call_failed`. Model RESOLUTION now happens inside
     * the wrapped call — the transport hands the whole request to
     * `app.modelProviders.translate`, which resolves the model and then asks
     * it — so a disabled provider, raised from the same resolution step as the
     * missing-model refusal one test above, is flattened on the way out. The
     * customer gets the generic "check your model configuration" copy instead
     * of the provider-disabled copy naming the alternate model.
     *
     * Asserted as it is so the wire shape is pinned and the divergence is
     * visible; teaching `wrapAiCall` to pass `ModelProviderDisabledError`
     * through must flip this test back to the MODEL_PROVIDER_DISABLED cause.
     */
    it("flattens a disabled provider into the generic AI-call failure", async () => {
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
      mockTranslate.mockRejectedValue(modelError);

      const error = await caller
        .translate({ projectId: "project_abc123", textToTranslate: "Hola" })
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      const wire = errorFormatter({
        shape: { data: {} },
        error: error as { cause?: unknown },
      });
      expect(wire.data.cause).toMatchObject({
        code: "AI_CALL_FAILED",
        featureKey: "translate.text",
      });
      // The provider the refusal named is not on the wire, which is what the
      // provider-disabled toast needs and no longer receives.
      expect(wire.data.cause).not.toHaveProperty("providerKey");
    });
  });
});
