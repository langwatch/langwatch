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
});
