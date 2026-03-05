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

  const defaultModelParamsResult = {
    success: true as const,
    params: defaultModelParams,
  };

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
      prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
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

  describe("model selection", () => {
    describe("given a prompt with a specific model configured", () => {
      const promptWithModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: "openai/gpt-4",
        temperature: 0.7,
        maxTokens: 1000,
      };

      describe("when prefetching scenario data", () => {
        it("uses the prompt's configured model", async () => {
          const mockModelParamsProvider: ModelParamsProvider = {
            prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
          };

          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
            },
            modelParamsProvider: mockModelParamsProvider,
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "openai/gpt-4",
          );
        });
      });
    });

    describe("given a prompt without a model configured", () => {
      const promptWithoutModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: null,
        temperature: 0.7,
        maxTokens: 1000,
      };

      describe("when prefetching scenario data", () => {
        it("falls back to project defaultModel", async () => {
          const mockModelParamsProvider: ModelParamsProvider = {
            prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
          };

          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithoutModel),
            },
            modelParamsProvider: mockModelParamsProvider,
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "anthropic/claude-3-sonnet",
          );
        });
      });
    });

    describe("given an HTTP agent target", () => {
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

      describe("when prefetching scenario data", () => {
        it("uses project defaultModel (agents have no model)", async () => {
          const mockModelParamsProvider: ModelParamsProvider = {
            prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
          };

          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(httpAgent),
            },
            modelParamsProvider: mockModelParamsProvider,
          });

          const target: TargetConfig = { type: "http", referenceId: "agent_123" };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "anthropic/claude-3-sonnet",
          );
        });
      });
    });
  });

  describe("error handling", () => {
    describe("given scenario does not exist", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure with scenario not found error", async () => {
          const deps = createMockDeps({
            scenarioFetcher: {
              getById: vi.fn().mockResolvedValue(null),
            },
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("Scenario scen_123 not found");
          }
        });
      });
    });

    describe("given project does not exist", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure with project not found error", async () => {
          const deps = createMockDeps({
            projectFetcher: {
              findUnique: vi.fn().mockResolvedValue(null),
            },
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("Project proj_123 not found");
          }
        });
      });
    });

    describe("given prompt does not exist", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure with prompt not found error", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
            },
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("Prompt prompt_123 not found");
          }
        });
      });
    });

    describe("given HTTP agent does not exist", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure with agent not found error", async () => {
          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(null),
            },
          });

          const target: TargetConfig = { type: "http", referenceId: "agent_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("HTTP agent agent_123 not found");
          }
        });
      });
    });

    describe("given code agent does not exist", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure with code agent not found error", async () => {
          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(null),
            },
          });

          const target: TargetConfig = { type: "code", referenceId: "agent_456" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("Code agent");
            expect(result.error).toContain("not found");
          }
        });
      });
    });

    describe("given code agent has wrong type", () => {
      describe("when prefetching scenario data", () => {
        it("returns failure when agent type mismatch", async () => {
          const httpAgent = {
            id: "agent_456",
            type: "http" as const,
            name: "HTTP Agent",
            projectId: "proj_123",
            config: {
              url: "https://api.example.com",
              method: "POST",
              headers: [],
            },
            workflowId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            archivedAt: null,
          };

          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(httpAgent),
            },
          });

          const target: TargetConfig = { type: "code", referenceId: "agent_456" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain("Code agent");
            expect(result.error).toContain("not found");
          }
        });
      });
    });

    describe("given model params preparation fails", () => {
      const promptWithModel = {
        id: "prompt_123",
        prompt: "You are helpful",
        messages: [],
        model: "openai/gpt-4",
      };

      describe("when prefetching scenario data", () => {
        it("returns failure with model params error", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
            },
            modelParamsProvider: {
              prepare: vi.fn().mockResolvedValue({
                success: false,
                reason: "provider_not_enabled",
                message: "Provider 'openai' is not enabled for this project",
              }),
            },
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe("Provider 'openai' is not enabled for this project");
            expect(result.reason).toBe("provider_not_enabled");
          }
        });
      });
    });
  });

  describe("code agent prefetch", () => {
    describe("given a code agent exists with Python code and inputs/outputs", () => {
      const codeAgent = {
        id: "agent_456",
        type: "code" as const,
        name: "Classifier",
        projectId: "proj_123",
        config: {
          parameters: [
            { identifier: "code", type: "code", value: 'def execute(input):\n    return "classified"' },
          ],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
        workflowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      describe("when prefetching scenario data", () => {
        it("fetches the agent and serializes code, inputs, and outputs", async () => {
          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(codeAgent),
            },
          });

          const target: TargetConfig = { type: "code", referenceId: "agent_456" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.adapterData).toMatchObject({
              type: "code",
              agentId: "agent_456",
              code: 'def execute(input):\n    return "classified"',
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            });
          }
        });

        it("uses project defaultModel (code agents have no model)", async () => {
          const mockModelParamsProvider: ModelParamsProvider = {
            prepare: vi.fn().mockResolvedValue(defaultModelParams),
          };

          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(codeAgent),
            },
            modelParamsProvider: mockModelParamsProvider,
          });

          const target: TargetConfig = { type: "code", referenceId: "agent_456" };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "anthropic/claude-3-sonnet",
          );
        });
      });
    });
  });

  describe("successful prefetch", () => {
    describe("given all dependencies return valid data", () => {
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

      describe("when prefetching scenario data", () => {
        it("returns success with complete data", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
            },
          });

          const target: TargetConfig = { type: "prompt", referenceId: "prompt_123" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

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
            expect(result.data.target).toEqual({ type: "prompt", referenceId: "prompt_123" });
            expect(result.telemetry).toEqual({
              endpoint: "http://localhost:3000",
              apiKey: "test-api-key",
            });
          }
        });
      });
    });
  });
});
