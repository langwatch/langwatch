import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { prisma } from "~/server/db";
import { getProjectModelProviders } from "~/server/api/routers/modelProviders.utils";
import { getVercelAIModel } from "../utils";

const mockPrismaFindUnique = prisma.project.findUnique as ReturnType<typeof vi.fn>;
const mockGetProjectModelProviders = getProjectModelProviders as ReturnType<typeof vi.fn>;

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
        getVercelAIModel("project-123", "azure/my-gpt4-deployment"),
      ).rejects.toThrow(
        'Model provider "azure" is not configured for this project.',
      );
    });

    it("throws descriptive error when azure provider is disabled", async () => {
      mockGetProjectModelProviders.mockResolvedValue({
        azure: { provider: "azure", enabled: false, customKeys: null },
      });

      await expect(
        getVercelAIModel("project-123", "azure/my-gpt4-deployment"),
      ).rejects.toThrow(
        'Model provider "azure" is configured but disabled.',
      );
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

        const result = await getVercelAIModel("project-123");

        expect(result).toBeDefined();
      });
    });

    describe("when openai provider is enabled", () => {
      it("falls back to DEFAULT_MODEL", async () => {
        mockGetProjectModelProviders.mockResolvedValue({
          openai: {
            provider: "openai",
            enabled: true,
            customKeys: null,
            customModels: null,
          },
        });

        const result = await getVercelAIModel("project-123");

        expect(result).toBeDefined();
      });
    });

    describe("when no providers are configured", () => {
      it("throws error about no providers configured", async () => {
        mockGetProjectModelProviders.mockResolvedValue({});

        await expect(getVercelAIModel("project-123")).rejects.toThrow(
          "No model providers configured",
        );
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
              { modelId: "my-deployment", displayName: "My Deploy", mode: "chat" },
            ],
          },
        });

        await expect(getVercelAIModel("project-123")).rejects.toThrow(
          "All configured model providers are disabled",
        );
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

        const result = await getVercelAIModel("project-123");

        expect(result).toBeDefined();
      });
    });
  });
});
