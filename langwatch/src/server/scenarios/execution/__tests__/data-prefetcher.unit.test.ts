/**
 * @vitest-environment node
 *
 * Unit tests for data-prefetcher module.
 *
 * Tests model selection logic to ensure correct model is used
 * based on prompt configuration vs project defaults.
 *
 * Uses dependency injection for clean, fast tests without vi.mock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  prefetchScenarioData,
  type DataPrefetcherDependencies,
  type ScenarioFetcher,
  type PromptFetcher,
  type AgentFetcher,
  type ProjectFetcher,
  type ModelParamsProvider,
} from "../data-prefetcher";
import type { ExecutionContext, TargetConfig, LiteLLMParams } from "../types";

// Mock only env.mjs since it's a module-level import
vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://localhost:8080",
    BASE_HOST: "http://localhost:3000",
  },
}));

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

  const defaultModelParams: LiteLLMParams = {
    api_key: "test-key",
    model: "openai/gpt-4",
  };

  // Helper to create mock dependencies
  function createMockDeps(
    overrides: Partial<DataPrefetcherDependencies> = {},
  ): DataPrefetcherDependencies {
    const scenarioFetcher: ScenarioFetcher = {
      getById: vi.fn().mockResolvedValue(defaultScenario),
    };

    const promptFetcher: PromptFetcher = {
      getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
    };

    const agentFetcher: AgentFetcher = {
      findById: vi.fn().mockResolvedValue(null),
    };

    const projectFetcher: ProjectFetcher = {
      findUnique: vi.fn().mockResolvedValue(defaultProject),
    };

    const modelParamsProvider: ModelParamsProvider = {
      prepare: vi.fn().mockResolvedValue(defaultModelParams),
    };

    return {
      scenarioFetcher,
      promptFetcher,
      agentFetcher,
      projectFetcher,
      modelParamsProvider,
      ...overrides,
    };
  }

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

      const mockModelParamsProvider: ModelParamsProvider = {
        prepare: vi.fn().mockResolvedValue(defaultModelParams),
      };

      const deps = createMockDeps({
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
        },
        modelParamsProvider: mockModelParamsProvider,
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target, deps);

      // Then: modelParamsProvider.prepare is called with the prompt's model
      expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
        "proj_123",
        "openai/gpt-4",
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

      const mockModelParamsProvider: ModelParamsProvider = {
        prepare: vi.fn().mockResolvedValue(defaultModelParams),
      };

      const deps = createMockDeps({
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithoutModel),
        },
        modelParamsProvider: mockModelParamsProvider,
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target, deps);

      // Then: modelParamsProvider.prepare is called with the project's default model
      expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
        "proj_123",
        "anthropic/claude-3-sonnet", // project.defaultModel
      );
    });

    it("uses project defaultModel for HTTP agent targets", async () => {
      // Given: an HTTP agent target (which has no model of its own)
      const httpAgent = {
        id: "agent_123",
        type: "http" as const,
        name: "Test Agent",
        projectId: "proj_123",
        config: {
          url: "https://api.example.com/chat",
          method: "POST",
          headers: [],
        },
        workflowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      const mockModelParamsProvider: ModelParamsProvider = {
        prepare: vi.fn().mockResolvedValue(defaultModelParams),
      };

      const deps = createMockDeps({
        agentFetcher: {
          findById: vi.fn().mockResolvedValue(httpAgent),
        },
        modelParamsProvider: mockModelParamsProvider,
      });

      const target: TargetConfig = { type: "http", referenceId: "agent_123" };

      // When: prefetching scenario data
      await prefetchScenarioData(defaultContext, target, deps);

      // Then: modelParamsProvider.prepare is called with the project's default model
      expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
        "proj_123",
        "anthropic/claude-3-sonnet", // project.defaultModel
      );
    });

    it("returns error when scenario not found", async () => {
      // Given: scenario does not exist
      const deps = createMockDeps({
        scenarioFetcher: {
          getById: vi.fn().mockResolvedValue(null),
        },
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns failure with scenario not found error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Scenario scen_123 not found");
      }
    });

    it("returns error when project not found", async () => {
      // Given: project does not exist
      const deps = createMockDeps({
        projectFetcher: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns failure with project not found error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Project proj_123 not found");
      }
    });

    it("returns error when prompt not found", async () => {
      // Given: prompt does not exist
      const deps = createMockDeps({
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
        },
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns failure with prompt not found error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Prompt prompt_123 not found");
      }
    });

    it("returns error when HTTP agent not found", async () => {
      // Given: agent does not exist
      const deps = createMockDeps({
        agentFetcher: {
          findById: vi.fn().mockResolvedValue(null),
        },
      });

      const target: TargetConfig = { type: "http", referenceId: "agent_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns failure with agent not found error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("HTTP agent agent_123 not found");
      }
    });

    it("returns error when model params preparation fails", async () => {
      // Given: model params preparation fails
      const promptWithModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: "openai/gpt-4",
      };

      const deps = createMockDeps({
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
        },
        modelParamsProvider: {
          prepare: vi.fn().mockResolvedValue(null),
        },
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns failure with model params error
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Failed to prepare model params");
      }
    });

    it("returns success with all data when everything succeeds", async () => {
      // Given: all dependencies return valid data
      const promptWithModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        model: "openai/gpt-4",
        temperature: 0.7,
        maxTokens: 1000,
      };

      const deps = createMockDeps({
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
        },
      });

      const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

      // When: prefetching scenario data
      const result = await prefetchScenarioData(defaultContext, target, deps);

      // Then: returns success with complete data
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context).toEqual(defaultContext);
        expect(result.data.scenario).toEqual(defaultScenario);
        expect(result.data.adapterData).toMatchObject({
          type: "prompt",
          promptId: "prompt_123",
          systemPrompt: "You are helpful",
        });
        expect(result.data.modelParams).toEqual(defaultModelParams);
        expect(result.telemetry).toEqual({
          endpoint: "http://localhost:3000",
          apiKey: "test-api-key",
        });
      }
    });
  });
});
