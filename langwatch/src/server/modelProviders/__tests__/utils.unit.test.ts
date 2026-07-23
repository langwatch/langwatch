import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma before importing the module under test
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock getProjectModelProviders to avoid real DB calls
vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn().mockResolvedValue({
    model: "azure/my-gpt4-deployment",
    api_key: "sk-azure-test",
  }),
}));

// Mock env
vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://localhost:5560",
  },
}));

// The codex handle dials the AI gateway; a sentinel keeps the test on the
// gating logic (which models may reach it) rather than the gateway wiring.
vi.mock("../codexGatewayModel", () => ({
  getCodexVercelAIModel: vi.fn().mockResolvedValue("codex-model-handle"),
}));

import { getProjectModelProviders } from "~/server/api/routers/modelProviders.utils";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "../utils";

const mockPrismaFindUnique = prisma.project.findUnique as ReturnType<
  typeof vi.fn
>;
const mockGetProjectModelProviders = getProjectModelProviders as ReturnType<
  typeof vi.fn
>;

describe("getVercelAIModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaFindUnique.mockResolvedValue({
      id: "project-123",
      defaultModel: "azure/my-gpt4-deployment",
    });
  });

  describe("when project uses Azure provider", () => {
    it("throws descriptive error when azure provider is not configured", async () => {
      mockGetProjectModelProviders.mockResolvedValue({});

      await expect(
        getVercelAIModel({
          projectId: "project-123",
          model: "azure/my-gpt4-deployment",
        }),
      ).rejects.toThrow(
        'Model provider "azure" is not configured for this project.',
      );
    });

    it("throws descriptive error when azure provider is disabled", async () => {
      mockGetProjectModelProviders.mockResolvedValue({
        azure: { provider: "azure", enabled: false, customKeys: null },
      });

      await expect(
        getVercelAIModel({
          projectId: "project-123",
          model: "azure/my-gpt4-deployment",
        }),
      ).rejects.toThrow('Model provider "azure" is configured but disabled.');
    });
  });

  describe("when an explicit codex model is requested", () => {
    it("rejects when the codex provider is not connected", async () => {
      mockGetProjectModelProviders.mockResolvedValue({});

      await expect(
        getVercelAIModel({
          projectId: "project-123",
          model: "openai_codex/gpt-5.6-terra",
          featureKey: "langy.chat",
        }),
      ).rejects.toThrow(
        'Model provider "openai_codex" is not configured for this project.',
      );
    });

    it("rejects when the codex provider row is disabled", async () => {
      mockGetProjectModelProviders.mockResolvedValue({
        openai_codex: {
          provider: "openai_codex",
          enabled: false,
          customKeys: null,
        },
      });

      await expect(
        getVercelAIModel({
          projectId: "project-123",
          model: "openai_codex/gpt-5.6-terra",
          featureKey: "langy.chat",
        }),
      ).rejects.toThrow(
        'Model provider "openai_codex" is configured but disabled.',
      );
    });

    it("returns the gateway handle when the provider is connected and enabled", async () => {
      mockGetProjectModelProviders.mockResolvedValue({
        openai_codex: {
          provider: "openai_codex",
          enabled: true,
          customKeys: { CODEX_ACCESS_TOKEN: "tok" },
        },
      });

      const result = await getVercelAIModel({
        projectId: "project-123",
        model: "openai_codex/gpt-5.6-terra",
        featureKey: "langy.chat",
      });

      expect(result).toBe("codex-model-handle");
    });
  });

  describe("when project defaultModel is null", () => {
    beforeEach(() => {
      mockPrismaFindUnique.mockResolvedValue({
        id: "project-123",
        defaultModel: null,
      });
    });

    describe("when azure provider is enabled with custom models", () => {
      it("resolves model from azure custom models", async () => {
        mockGetProjectModelProviders.mockResolvedValue({
          azure: {
            provider: "azure",
            enabled: true,
            customKeys: null,
            customModels: [
              {
                modelId: "my-gpt4-deployment",
                displayName: "My GPT-4",
                mode: "chat",
              },
            ],
          },
        });

        const result = await getVercelAIModel({ projectId: "project-123" });

        expect(result).toBeDefined();
      });
    });

    describe("when openai provider is enabled but has no usable models", () => {
      it("throws because no global default fallback exists", async () => {
        // With the no-global-fallback contract, "openai is enabled but
        // has no custom models and no ModelDefaultConfig entry" is the
        // canonical 'AI features are disabled for this project'
        // surface. The legacy DEFAULT_MODEL constant no longer rescues.
        mockGetProjectModelProviders.mockResolvedValue({
          openai: {
            provider: "openai",
            enabled: true,
            customKeys: null,
            customModels: null,
          },
        });

        await expect(
          getVercelAIModel({ projectId: "project-123" }),
        ).rejects.toThrow(
          /All configured model providers are disabled or have no usable models/,
        );
      });
    });

    describe("when no providers are configured", () => {
      it("throws error about no providers configured", async () => {
        mockGetProjectModelProviders.mockResolvedValue({});

        await expect(
          getVercelAIModel({ projectId: "project-123" }),
        ).rejects.toThrow("No model providers configured");
      });
    });

    describe("when providers exist but all are disabled", () => {
      it("throws error about disabled providers", async () => {
        mockGetProjectModelProviders.mockResolvedValue({
          azure: {
            provider: "azure",
            enabled: false,
            customKeys: null,
            customModels: [
              {
                modelId: "my-deployment",
                displayName: "My Deploy",
                mode: "chat",
              },
            ],
          },
        });

        await expect(
          getVercelAIModel({ projectId: "project-123" }),
        ).rejects.toThrow("All configured model providers are disabled");
      });
    });

    describe("when defaultModel provider is not configured but another is", () => {
      it("resolves from the available provider", async () => {
        mockPrismaFindUnique.mockResolvedValue({
          id: "project-123",
          defaultModel: "openai/gpt-4",
        });
        mockGetProjectModelProviders.mockResolvedValue({
          azure: {
            provider: "azure",
            enabled: true,
            customKeys: null,
            customModels: [
              {
                modelId: "my-gpt4-deployment",
                displayName: "My GPT-4",
                mode: "chat",
              },
            ],
          },
        });

        const result = await getVercelAIModel({ projectId: "project-123" });

        expect(result).toBeDefined();
      });
    });
  });
});
