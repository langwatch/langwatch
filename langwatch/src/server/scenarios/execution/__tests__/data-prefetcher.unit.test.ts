/**
 * @vitest-environment node
 *
 * Unit tests for data-prefetcher module.
 *
 * Tests model selection logic to ensure correct model is used
 * based on prompt configuration vs project defaults.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://localhost:8080",
    BASE_HOST: "http://localhost:3000",
  },
}));

vi.mock("../../../db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../api/routers/modelProviders", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
}));

vi.mock("../../../prompt-config/prompt.service", () => ({
  PromptService: vi.fn().mockImplementation(() => ({
    getPromptByIdOrHandle: vi.fn(),
  })),
}));

vi.mock("../../scenario.service", () => ({
  ScenarioService: {
    create: vi.fn().mockReturnValue({
      getById: vi.fn(),
    }),
  },
}));

vi.mock("../../../agents/agent.repository", () => ({
  AgentRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

import { prisma } from "../../../db";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../../api/routers/modelProviders";
import { PromptService } from "../../../prompt-config/prompt.service";
import { ScenarioService } from "../../scenario.service";
import { AgentRepository } from "../../../agents/agent.repository";
import { prefetchScenarioData } from "../data-prefetcher";
import type { ExecutionContext, TargetConfig } from "../types";

const mockProjectFindUnique = vi.mocked(prisma.project.findUnique);
const mockGetProjectModelProviders = vi.mocked(getProjectModelProviders);
const mockPrepareLitellmParams = vi.mocked(prepareLitellmParams);

describe("prefetchScenarioData", () => {
  const defaultContext: ExecutionContext = {
    projectId: "proj_123",
    scenarioId: "scen_123",
    setId: "set_123",
    batchRunId: "batch_123",
  };

  const defaultScenario = {
    id: "scen_123",
    name: "Test Scenario",
    situation: "User asks a question",
    criteria: ["Must respond politely"],
    labels: [],
  };

  const defaultProject = {
    apiKey: "test-api-key",
    defaultModel: "anthropic/claude-3-sonnet",
  };

  const defaultModelParams = {
    api_key: "test-key",
    model: "openai/gpt-4",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks for ScenarioService
    const mockScenarioService = {
      getById: vi.fn().mockResolvedValue(defaultScenario),
    };
    vi.mocked(ScenarioService.create).mockReturnValue(mockScenarioService as any);

    // Setup default mocks for project lookup
    mockProjectFindUnique.mockResolvedValue(defaultProject as any);

    // Setup default mocks for model providers
    mockGetProjectModelProviders.mockResolvedValue({
      openai: { enabled: true },
      anthropic: { enabled: true },
    } as any);
    mockPrepareLitellmParams.mockResolvedValue(defaultModelParams);
  });

  describe("model selection for fetchModelParams", () => {
    it("uses prompt's configured model when prompt has model set", async () => {
      // Given: a prompt with a specific model configured
      const promptWithModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: "openai/gpt-4",
        temperature: 0.7,
        maxTokens: 1000,
      };

      const mockPromptService = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
      };
      vi.mocked(PromptService).mockImplementation(() => mockPromptService as any);

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target);

      // Then: fetchModelParams is called with the prompt's model
      expect(mockPrepareLitellmParams).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai/gpt-4",
        }),
      );
    });

    it("falls back to project defaultModel when prompt has no model", async () => {
      // Given: a prompt without a model configured and project has defaultModel
      const promptWithoutModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: null, // No model set
        temperature: 0.7,
        maxTokens: 1000,
      };

      const mockPromptService = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithoutModel),
      };
      vi.mocked(PromptService).mockImplementation(() => mockPromptService as any);

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target);

      // Then: fetchModelParams is called with the project's default model
      expect(mockPrepareLitellmParams).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic/claude-3-sonnet", // project.defaultModel
        }),
      );
    });

    it("uses project defaultModel for HTTP agent targets", async () => {
      // Given: an HTTP agent target (which has no model of its own)
      const httpAgent = {
        id: "agent_123",
        type: "http",
        config: {
          url: "https://api.example.com/chat",
          method: "POST",
          headers: [],
        },
      };

      const mockAgentRepo = {
        findById: vi.fn().mockResolvedValue(httpAgent),
      };
      vi.mocked(AgentRepository).mockImplementation(() => mockAgentRepo as any);

      const target: TargetConfig = { type: "http", referenceId: "agent_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target);

      // Then: fetchModelParams is called with the project's default model
      expect(mockPrepareLitellmParams).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic/claude-3-sonnet", // project.defaultModel
        }),
      );
    });

    it("returns error when project has no defaultModel configured", async () => {
      // Given: project has no defaultModel set
      mockProjectFindUnique.mockResolvedValue({
        apiKey: "test-api-key",
        defaultModel: null,
      } as any);

      // And: a prompt without its own model
      const promptWithoutModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: null,
        temperature: 0.7,
        maxTokens: 1000,
      };

      const mockPromptService = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithoutModel),
      };
      vi.mocked(PromptService).mockImplementation(() => mockPromptService as any);

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target);

      // Then: returns failure with clear error message
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Project default model is not configured");
      }
    });
  });
});
