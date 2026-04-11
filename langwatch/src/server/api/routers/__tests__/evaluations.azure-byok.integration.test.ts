/**
 * @vitest-environment node
 *
 * Integration tests for the availableEvaluators tRPC router — Azure Safety BYOK.
 *
 * Covers @integration scenarios from specs/evaluators/azure-safety-byok-gating.feature:
 * - "availableEvaluators reports missing env vars for Azure when provider is absent"
 * - "availableEvaluators reports no missing env vars when provider is fully configured"
 * - "availableEvaluators ignores process.env for Azure evaluators"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectModelProvidersMock } = vi.hoisted(() => ({
  getProjectModelProvidersMock: vi.fn(),
}));

vi.mock("~/server/api/routers/modelProviders.utils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/api/routers/modelProviders.utils")
    >();
  return {
    ...actual,
    getProjectModelProviders: getProjectModelProvidersMock,
  };
});

// evaluationsRouter pulls in runEvaluationForTrace from the legacy worker,
// which in turn imports the BullMQ/Redis stack. Stub it to keep the router
// import light in unit-style integration tests.
vi.mock("~/server/background/workers/evaluationsWorker", () => ({
  runEvaluationForTrace: vi.fn(),
  runEvaluationJob: vi.fn(),
  startEvaluationsWorker: vi.fn(),
}));

// Bypass the RBAC middleware — we're testing the handler logic, not auth.
vi.mock("../../rbac", () => ({
  checkProjectPermission:
    () =>
    ({ next, ctx }: { next: () => unknown; ctx: { permissionChecked?: boolean } }) => {
      ctx.permissionChecked = true;
      return next();
    },
}));

import { evaluationsRouter } from "../evaluations";

function createCaller(_projectId: string) {
  return evaluationsRouter.createCaller({
    session: {
      user: { id: "user-test", email: "test@example.com" },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    },
    prisma: {} as never,
    permissionChecked: true,
  } as unknown as Parameters<typeof evaluationsRouter.createCaller>[0]);
}

describe("Feature: evaluationsRouter.availableEvaluators — Azure BYOK", () => {
  const projectId = "proj-byok-1";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT = "https://shared.example.com/";
    process.env.AZURE_CONTENT_SAFETY_KEY = "shared-key";
  });

  describe("given the project has no azure_safety provider", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({});
    });

    describe("when the client queries availableEvaluators", () => {
      it("marks azure/content_safety with missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/content_safety"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("marks azure/prompt_injection with missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/prompt_injection"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("marks azure/jailbreak with missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/jailbreak"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });

      it("ignores process.env for Azure evaluators", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        // process.env has AZURE_CONTENT_SAFETY_* set in beforeEach but the
        // router must NOT use it.
        expect(result["azure/content_safety"]?.missingEnvVars).toHaveLength(2);
      });

      it("still reads non-Azure envVars from process.env", async () => {
        process.env.OPENAI_API_KEY = "sk-test";
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        // openai/moderation declares OPENAI_API_KEY in envVars;
        // with it set in process.env, missingEnvVars is empty.
        expect(result["openai/moderation"]?.missingEnvVars).toEqual([]);
        delete process.env.OPENAI_API_KEY;
      });
    });
  });

  describe("given the project has azure_safety enabled with both keys", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({
        azure_safety: {
          provider: "azure_safety",
          enabled: true,
          customKeys: {
            AZURE_CONTENT_SAFETY_ENDPOINT:
              "https://byok.cognitiveservices.azure.com/",
            AZURE_CONTENT_SAFETY_KEY: "byok-key",
          },
        },
      });
    });

    describe("when the client queries availableEvaluators", () => {
      it("marks azure/content_safety with empty missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/content_safety"]?.missingEnvVars).toEqual([]);
      });

      it("marks azure/prompt_injection with empty missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/prompt_injection"]?.missingEnvVars).toEqual([]);
      });

      it("marks azure/jailbreak with empty missingEnvVars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/jailbreak"]?.missingEnvVars).toEqual([]);
      });
    });
  });

  describe("given the azure_safety provider is disabled", () => {
    beforeEach(() => {
      getProjectModelProvidersMock.mockResolvedValue({
        azure_safety: {
          provider: "azure_safety",
          enabled: false,
          customKeys: {
            AZURE_CONTENT_SAFETY_ENDPOINT:
              "https://byok.cognitiveservices.azure.com/",
            AZURE_CONTENT_SAFETY_KEY: "byok-key",
          },
        },
      });
    });

    describe("when the client queries availableEvaluators", () => {
      it("marks Azure evaluators as missing env vars", async () => {
        const caller = createCaller(projectId);
        const result = await caller.availableEvaluators({ projectId });
        expect(result["azure/content_safety"]?.missingEnvVars).toEqual([
          "AZURE_CONTENT_SAFETY_ENDPOINT",
          "AZURE_CONTENT_SAFETY_KEY",
        ]);
      });
    });
  });
});
