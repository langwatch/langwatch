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

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import {
  type AgentFetcher,
  type DataPrefetcherDependencies,
  type ModelParamsProvider,
  type ModelParamsResult,
  type ProjectFetcher,
  type ProjectSecretsFetcher,
  type PromptFetcher,
  prefetchScenarioData,
  type ScenarioFetcher,
  type SuiteConfigFetcher,
  type WorkflowVersionFetcher,
} from "../data-prefetcher";
import type { ExecutionContext, LiteLLMParams, TargetConfig } from "../types";

// Mock only env.mjs since it's a module-level import
vi.mock("~/env.mjs", () => ({
  env: {
    LANGWATCH_NLP_SERVICE: "http://langwatch_nlp:5561",
    LANGWATCH_ENDPOINT: "http://app:5560",
    // BASE_HOST no longer needed — telemetry endpoint comes from LANGWATCH_ENDPOINT
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

    const suiteConfigFetcher: SuiteConfigFetcher = {
      getBySetId: vi.fn().mockResolvedValue(null),
    };

    const promptFetcher: PromptFetcher = {
      getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
    };

    const agentFetcher: AgentFetcher = {
      findById: vi.fn().mockResolvedValue(null),
    };

    const workflowVersionFetcher: WorkflowVersionFetcher = {
      getLatestDsl: vi.fn().mockResolvedValue(null),
    };

    const projectFetcher: ProjectFetcher = {
      findUnique: vi.fn().mockResolvedValue(defaultProject),
    };

    const modelParamsProvider: ModelParamsProvider = {
      prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
    };

    const projectSecretsFetcher: ProjectSecretsFetcher = {
      getSecrets: vi.fn().mockResolvedValue({}),
    };

    const modelResolver = {
      // Distinguish every feature key so simulator/judge/agent-under-test
      // selection can be asserted independently of one another.
      // "scenarios.generator" (the FAST-role authoring assist, used only by
      // scenario generation, not by a run) is deliberately given its OWN
      // distinguishable value so a resolver call against the WRONG key
      // (the pre-#6634 bug) is observable rather than accidentally
      // matching the agent-under-test value.
      resolve: vi.fn().mockImplementation(async (featureKey: string) => {
        const modelByFeatureKey: Record<string, string> = {
          "scenarios.user_simulator": "openai/sim-default",
          "scenarios.judge": "openai/judge-default",
          "scenarios.agent_under_test": "anthropic/claude-3-sonnet",
          "scenarios.generator": "anthropic/wrong-key-generator",
        };
        const model = modelByFeatureKey[featureKey];
        if (!model)
          throw new Error(`unexpected feature key resolved: "${featureKey}"`);
        return model;
      }),
    };

    return {
      scenarioFetcher,
      suiteConfigFetcher,
      promptFetcher,
      agentFetcher,
      workflowVersionFetcher,
      projectFetcher,
      modelParamsProvider,
      modelResolver,
      projectSecretsFetcher,
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

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "openai/gpt-4",
          );
        });

        /** @scenario "A prompt with its own model never consults the agent-under-test default" */
        it("never calls the agent-under-test resolver", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
            },
          });

          await prefetchScenarioData(
            defaultContext,
            {
              type: "prompt",
              referenceId: "prompt_123",
            },
            deps,
          );

          expect(deps.modelResolver.resolve).not.toHaveBeenCalledWith(
            "scenarios.agent_under_test",
            expect.anything(),
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
        /** @scenario "A prompt without a model resolves the agent-under-test default" */
        /** @scenario "A FAST-only-codex project still resolves the DEFAULT-role agent-under-test key for prompts" */
        it("resolves the agent-under-test model, not the scenario-generator model", async () => {
          const mockModelParamsProvider: ModelParamsProvider = {
            prepare: vi.fn().mockResolvedValue(defaultModelParamsResult),
          };

          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi
                .fn()
                .mockResolvedValue(promptWithoutModel),
            },
            modelParamsProvider: mockModelParamsProvider,
          });

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };

          await prefetchScenarioData(defaultContext, target, deps);

          expect(deps.modelResolver.resolve).toHaveBeenCalledWith(
            "scenarios.agent_under_test",
            "proj_123",
          );
          expect(deps.modelResolver.resolve).not.toHaveBeenCalledWith(
            "scenarios.generator",
            expect.anything(),
          );
          // The mock resolver maps this key to its OWN distinguishable
          // value ("anthropic/claude-3-sonnet") — the old
          // "scenarios.generator" key resolves to a different value
          // ("anthropic/wrong-key-generator"), so this assertion fails if
          // the wrong key is resolved even though a model does come back.
          expect(mockModelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "anthropic/claude-3-sonnet",
          );
        });

        /** @scenario "A prompt without a model resolves the agent-under-test default" */
        it("calls the agent-under-test resolver exactly once", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi
                .fn()
                .mockResolvedValue(promptWithoutModel),
            },
          });

          await prefetchScenarioData(
            defaultContext,
            { type: "prompt", referenceId: "prompt_123" },
            deps,
          );

          const agentUnderTestCalls = (
            deps.modelResolver.resolve as ReturnType<typeof vi.fn>
          ).mock.calls.filter(
            ([featureKey]) => featureKey === "scenarios.agent_under_test",
          );
          expect(agentUnderTestCalls).toHaveLength(1);
        });

        /** @scenario "A prompt without a model resolves the agent-under-test default" */
        it("prepares model params exactly three times — agent, simulator, and judge", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi
                .fn()
                .mockResolvedValue(promptWithoutModel),
            },
          });

          const result = await prefetchScenarioData(
            defaultContext,
            { type: "prompt", referenceId: "prompt_123" },
            deps,
          );

          expect(result.success).toBe(true);
          expect(deps.modelParamsProvider.prepare).toHaveBeenCalledTimes(3);
        });
      });
    });

    describe("given a workflow, code, or HTTP target", () => {
      const httpAgent = {
        id: "agent_http",
        type: "http" as const,
        name: "Test HTTP Agent",
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
      const codeAgent = {
        id: "agent_code",
        type: "code" as const,
        name: "Test Code Agent",
        projectId: "proj_123",
        config: {
          parameters: [
            {
              identifier: "code",
              type: "code",
              value: "def execute(input):\n    return input",
            },
          ],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
        workflowId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };
      const workflowAgent = {
        id: "agent_workflow",
        type: "workflow" as const,
        name: "Test Workflow Agent",
        projectId: "proj_123",
        config: { workflow_id: "wf_123" },
        workflowId: "wf_123",
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };
      const emptyWorkflowDsl = {
        workflowId: "wf_123",
        dsl: { spec_version: "1.5", nodes: [], edges: [] },
      };

      const cases: Array<{
        label: "http" | "code" | "workflow";
        target: TargetConfig;
        agent: typeof httpAgent | typeof codeAgent | typeof workflowAgent;
      }> = [
        {
          label: "http",
          target: { type: "http", referenceId: "agent_http" },
          agent: httpAgent,
        },
        {
          label: "code",
          target: { type: "code", referenceId: "agent_code" },
          agent: codeAgent,
        },
        {
          label: "workflow",
          target: { type: "workflow", referenceId: "agent_workflow" },
          agent: workflowAgent,
        },
      ];

      describe.each(cases)("when the target is $label", ({ target, agent }) => {
        function depsFor(): DataPrefetcherDependencies {
          return createMockDeps({
            agentFetcher: { findById: vi.fn().mockResolvedValue(agent) },
            workflowVersionFetcher: {
              getLatestDsl: vi.fn().mockResolvedValue(emptyWorkflowDsl),
            },
          });
        }

        /** @scenario "A workflow target resolves no adapter-role model" */
        /** @scenario "A code target resolves no adapter-role model" */
        /** @scenario "An HTTP target resolves no adapter-role model and consumes no project key" */
        it("never calls the agent-under-test resolver", async () => {
          const deps = depsFor();

          await prefetchScenarioData(defaultContext, target, deps);

          expect(deps.modelResolver.resolve).not.toHaveBeenCalledWith(
            "scenarios.agent_under_test",
            expect.anything(),
          );
          expect(deps.modelResolver.resolve).not.toHaveBeenCalledWith(
            "scenarios.generator",
            expect.anything(),
          );
        });

        /** @scenario "The user-simulator and judge always resolve their own models" */
        it("prepares model params exactly twice — simulator and judge only", async () => {
          const deps = depsFor();

          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

          expect(result.success).toBe(true);
          expect(deps.modelParamsProvider.prepare).toHaveBeenCalledTimes(2);
          expect(deps.modelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "openai/sim-default",
          );
          expect(deps.modelParamsProvider.prepare).toHaveBeenCalledWith(
            "proj_123",
            "openai/judge-default",
          );
        });
      });
    });
  });

  describe("user-simulator and judge model selection", () => {
    const httpAgent = {
      id: "agent_http",
      type: "http" as const,
      name: "HTTP Agent",
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
    const httpTarget: TargetConfig = {
      type: "http",
      referenceId: "agent_http",
    };

    // Echoes the requested model back as params so the resolved simulator /
    // judge model is observable on result.data.{simulator,judge}ModelParams.
    const echoingProvider = (): ModelParamsProvider => ({
      prepare: vi
        .fn()
        .mockImplementation(async (_projectId: string, model: string) => ({
          success: true as const,
          params: { api_key: "k", model },
        })),
    });

    describe("given a scenario with no simulator or judge override", () => {
      describe("when prefetching the run data", () => {
        /** @scenario "Defaults resolve to the smart Default model when the scenario has no override" */
        it("resolves the simulator and judge from their DEFAULT-role feature keys", async () => {
          const deps = createMockDeps({
            agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
            modelParamsProvider: echoingProvider(),
          });

          const result = await prefetchScenarioData(
            defaultContext,
            httpTarget,
            deps,
          );

          expect(deps.modelResolver.resolve).toHaveBeenCalledWith(
            "scenarios.user_simulator",
            "proj_123",
          );
          expect(deps.modelResolver.resolve).toHaveBeenCalledWith(
            "scenarios.judge",
            "proj_123",
          );
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.simulatorModelParams?.model).toBe(
              "openai/sim-default",
            );
            expect(result.data.judgeModelParams?.model).toBe(
              "openai/judge-default",
            );
          }
        });
      });
    });

    describe("given a scenario with a simulator model override", () => {
      describe("when prefetching the run data", () => {
        /** @scenario "A scenario-level simulator override is used for the user-simulator" */
        it("uses the override for the simulator and the default for the judge", async () => {
          const deps = createMockDeps({
            scenarioFetcher: {
              getById: vi.fn().mockResolvedValue({
                ...defaultScenario,
                simulatorModel: "anthropic/sim-override",
                judgeModel: null,
              }),
            },
            agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
            modelParamsProvider: echoingProvider(),
          });

          const result = await prefetchScenarioData(
            defaultContext,
            httpTarget,
            deps,
          );

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.simulatorModelParams?.model).toBe(
              "anthropic/sim-override",
            );
            expect(result.data.judgeModelParams?.model).toBe(
              "openai/judge-default",
            );
          }
        });
      });
    });

    describe("given a scenario with a judge model override", () => {
      describe("when prefetching the run data", () => {
        /** @scenario "A scenario-level judge override is used for the judge" */
        it("uses the override for the judge and the default for the simulator", async () => {
          const deps = createMockDeps({
            scenarioFetcher: {
              getById: vi.fn().mockResolvedValue({
                ...defaultScenario,
                simulatorModel: null,
                judgeModel: "anthropic/judge-override",
              }),
            },
            agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
            modelParamsProvider: echoingProvider(),
          });

          const result = await prefetchScenarioData(
            defaultContext,
            httpTarget,
            deps,
          );

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.judgeModelParams?.model).toBe(
              "anthropic/judge-override",
            );
            expect(result.data.simulatorModelParams?.model).toBe(
              "openai/sim-default",
            );
          }
        });
      });
    });

    describe("given a run plan that sets a simulator model", () => {
      describe("when prefetching a scenario in that plan with no override", () => {
        /** @scenario "A run plan simulator model overrides the scenario default at run time" */
        it("uses the run plan's simulator model over the scenario default", async () => {
          const deps = createMockDeps({
            suiteConfigFetcher: {
              getBySetId: vi.fn().mockResolvedValue({
                simulatorModel: "groq/plan-sim",
                judgeModel: null,
              }),
            },
            agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
            modelParamsProvider: echoingProvider(),
          });

          const result = await prefetchScenarioData(
            defaultContext,
            httpTarget,
            deps,
          );

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.simulatorModelParams?.model).toBe(
              "groq/plan-sim",
            );
            // Plan leaves judge unset -> falls through to the default judge.
            expect(result.data.judgeModelParams?.model).toBe(
              "openai/judge-default",
            );
          }
        });
      });
    });

    describe("given a run plan with no model override", () => {
      describe("when prefetching a scenario in that plan with no override", () => {
        /** @scenario "A run plan with no model override falls back to the scenario or project default" */
        it("falls back to the default simulator and judge models", async () => {
          const deps = createMockDeps({
            suiteConfigFetcher: {
              getBySetId: vi.fn().mockResolvedValue({
                simulatorModel: null,
                judgeModel: null,
              }),
            },
            agentFetcher: { findById: vi.fn().mockResolvedValue(httpAgent) },
            modelParamsProvider: echoingProvider(),
          });

          const result = await prefetchScenarioData(
            defaultContext,
            httpTarget,
            deps,
          );

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.simulatorModelParams?.model).toBe(
              "openai/sim-default",
            );
            expect(result.data.judgeModelParams?.model).toBe(
              "openai/judge-default",
            );
          }
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

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

          const target: TargetConfig = {
            type: "http",
            referenceId: "agent_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

          const target: TargetConfig = {
            type: "code",
            referenceId: "agent_456",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

          const target: TargetConfig = {
            type: "code",
            referenceId: "agent_456",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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
        /** @scenario "Prefetcher logs model params failure with reason" */
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

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toBe(
              "Provider 'openai' is not enabled for this project",
            );
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
            {
              identifier: "code",
              type: "code",
              value: 'def execute(input):\n    return "classified"',
            },
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

          const target: TargetConfig = {
            type: "code",
            referenceId: "agent_456",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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

        // "uses project defaultModel (code agents have no model)" removed
        // (issue #6634): it asserted a code target resolves an
        // adapter-role model at all, which was the defect this issue
        // fixes. Superseded by the describe.each("given a workflow,
        // code, or HTTP target") block above (AC2 / AC-N8), which pins
        // the correct contract for code targets: the agent-under-test
        // resolver is never called, and model params are prepared
        // exactly twice — simulator and judge, never an adapter model.

        it("includes decrypted project secrets on the prefetched adapter data", async () => {
          const projectSecretsFetcher: ProjectSecretsFetcher = {
            getSecrets: vi.fn().mockResolvedValue({
              WORKFLOW_LANGWATCH_API_KEY: "sk-lw-resolved",
              OTHER_SECRET: "val2",
            }),
          };
          const deps = createMockDeps({
            agentFetcher: {
              findById: vi.fn().mockResolvedValue(codeAgent),
            },
            projectSecretsFetcher,
          });

          const target: TargetConfig = {
            type: "code",
            referenceId: "agent_456",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

          expect(projectSecretsFetcher.getSecrets).toHaveBeenCalledWith(
            "proj_123",
          );
          expect(result.success).toBe(true);
          // Assert explicitly before narrowing so a type drift fails loudly
          // instead of silently skipping the toEqual below.
          if (!result.success)
            throw new Error("prefetch should have succeeded");
          expect(result.data.adapterData.type).toBe("code");
          if (result.data.adapterData.type !== "code") return;
          expect(result.data.adapterData.secrets).toEqual({
            WORKFLOW_LANGWATCH_API_KEY: "sk-lw-resolved",
            OTHER_SECRET: "val2",
          });
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
        /** @scenario "Return success with LiteLLM params on valid configuration" */
        it("returns success with complete data", async () => {
          const deps = createMockDeps({
            promptFetcher: {
              getPromptByIdOrHandle: vi.fn().mockResolvedValue(promptWithModel),
            },
          });

          const target: TargetConfig = {
            type: "prompt",
            referenceId: "prompt_123",
          };
          const result = await prefetchScenarioData(
            defaultContext,
            target,
            deps,
          );

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
            expect(result.data.target).toEqual({
              type: "prompt",
              referenceId: "prompt_123",
            });
            expect(result.telemetry).toEqual({
              endpoint: "http://app:5560",
              apiKey: "test-api-key",
            });
          }
        });
      });
    });
  });

  describe("when the target is a workflow agent", () => {
    const workflowAgent = {
      id: "agent_wf",
      type: "workflow" as const,
      name: "Greeter",
      workflowId: "wf_1",
      config: {
        name: "Greeter",
        isCustom: true,
        workflow_id: "wf_1",
        scenarioMappings: {
          query: {
            type: "source",
            sourceId: "scenario",
            path: ["input"],
          },
        },
        scenarioOutputField: "answer",
      },
    };

    const workflowDsl = {
      workflow_id: "wf_1",
      nodes: [
        {
          id: "entry",
          type: "entry",
          data: {
            name: "Entry",
            outputs: [{ identifier: "query", type: "str" }],
          },
        },
        {
          id: "end",
          type: "end",
          data: {
            name: "End",
            inputs: [
              { identifier: "answer", type: "str" },
              { identifier: "trace", type: "str" },
            ],
          },
        },
      ],
      edges: [
        {
          id: "entry-greeter",
          source: "entry",
          sourceHandle: "outputs.query",
          target: "greeter",
          targetHandle: "inputs.query",
        },
      ],
    };

    const workflowTarget: TargetConfig = {
      type: "workflow",
      referenceId: "agent_wf",
    };

    describe("when the agent and workflow have a latest version", () => {
      it("returns WorkflowAgentData with inputs, outputs, mappings and workflow DSL", async () => {
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: workflowDsl,
            }),
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.adapterData.type).toBe("workflow");
          if (result.data.adapterData.type === "workflow") {
            expect(result.data.adapterData.agentId).toBe("agent_wf");
            expect(result.data.adapterData.workflowId).toBe("wf_1");
            expect(result.data.adapterData.inputs).toEqual([
              { identifier: "query", type: "str" },
            ]);
            expect(result.data.adapterData.outputs).toEqual([
              { identifier: "answer", type: "str" },
              { identifier: "trace", type: "str" },
            ]);
            expect(result.data.adapterData.scenarioMappings).toEqual({
              query: {
                type: "source",
                sourceId: "scenario",
                path: ["input"],
              },
            });
            expect(result.data.adapterData.scenarioOutputField).toBe("answer");
            expect(result.data.adapterData.workflow).toEqual(workflowDsl);
          }
        }
      });
    });

    describe("when the workflow has no saved version", () => {
      it("returns a friendly 'Workflow agent not found' error", async () => {
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue(null),
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("Workflow agent agent_wf not found");
        }
      });
    });

    describe("when the agent has no workflowId", () => {
      it("returns 'Workflow agent not found' without touching the version fetcher", async () => {
        const getLatestDsl = vi.fn();
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue({
              ...workflowAgent,
              workflowId: null,
              config: { ...workflowAgent.config, workflow_id: undefined },
            }),
          },
          workflowVersionFetcher: {
            getLatestDsl,
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe("Workflow agent agent_wf not found");
        }
        expect(getLatestDsl).not.toHaveBeenCalled();
      });
    });

    describe("when the DSL has a blank-template signature node with an undefined llm parameter value", () => {
      // Regression test for issue #3160:
      // Fresh workflow agents store value: undefined for the llm parameter in the
      // blank template DSL. The scenario execution path must hydrate litellm_params
      // onto each llm-type parameter before sending the DSL to the NLP service,
      // otherwise litellm raises AuthenticationError: Incorrect API key provided: dummy.
      const blankTemplateDsl = {
        workflow_id: "wf_1",
        nodes: [
          {
            id: "entry",
            type: "entry",
            data: {
              name: "Entry",
              outputs: [{ identifier: "question", type: "str" }],
            },
          },
          {
            id: "llm_call",
            type: "signature",
            data: {
              name: "LLM Call",
              parameters: [
                {
                  identifier: "llm",
                  type: "llm",
                  // value is undefined — this is the blank-template default
                  value: undefined,
                },
                {
                  identifier: "instructions",
                  type: "str",
                  value: undefined,
                },
              ],
              inputs: [{ identifier: "question", type: "str" }],
              outputs: [{ identifier: "answer", type: "str" }],
            },
          },
          {
            id: "end",
            type: "end",
            data: {
              name: "End",
              inputs: [{ identifier: "output", type: "str" }],
            },
          },
        ],
        edges: [
          {
            id: "e0-1",
            source: "entry",
            sourceHandle: "outputs.question",
            target: "llm_call",
            targetHandle: "inputs.question",
          },
          {
            id: "e1-2",
            source: "llm_call",
            sourceHandle: "outputs.answer",
            target: "end",
            targetHandle: "inputs.output",
          },
        ],
      };

      /** @scenario "Per-node workflow model credentials are untouched by the platform-key fix" */
      it("hydrates the llm parameter value with litellm_params from the project's model providers", async () => {
        const hydratedApiKey = "sk-real-project-key-abc123";

        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: blankTemplateDsl,
            }),
          },
          modelParamsProvider: {
            prepare: vi.fn().mockResolvedValue({
              success: true as const,
              params: {
                model: "openai/gpt-4o-mini",
                api_key: hydratedApiKey,
              },
            }),
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (result.success && result.data.adapterData.type === "workflow") {
          const nodes = result.data.adapterData.workflow.nodes as Array<
            Record<string, unknown>
          >;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;

          expect(signatureNode).toBeDefined();

          const data = signatureNode?.data as
            | Record<string, unknown>
            | undefined;
          const parameters = data?.parameters as
            | Array<Record<string, unknown>>
            | undefined;
          const llmParam = parameters?.find(
            (p) => p.identifier === "llm" && p.type === "llm",
          );

          expect(llmParam).toBeDefined();

          // The value must be hydrated — not undefined and not using the dummy key
          const value = llmParam?.value as Record<string, unknown> | undefined;
          expect(value).toBeDefined();
          expect(value?.litellm_params).toBeDefined();

          const litellmParams = value?.litellm_params as
            | Record<string, unknown>
            | undefined;
          expect(litellmParams?.api_key).toBeDefined();
          expect(litellmParams?.api_key).not.toBe("dummy");
          expect(litellmParams?.api_key).toBe(hydratedApiKey);
        }
      });
    });

    describe("when the DSL has a blank-template signature node and the model provider lookup fails", () => {
      // Test A: provider lookup fails → prefetch returns structured failure, not silent pass
      it("returns a structured failure with the provider reason, not a silent pass with dummy api_key", async () => {
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: {
                workflow_id: "wf_1",
                nodes: [
                  {
                    id: "llm_call",
                    type: "signature",
                    data: {
                      name: "LLM Call",
                      parameters: [
                        {
                          identifier: "llm",
                          type: "llm",
                          value: undefined,
                        },
                      ],
                    },
                  },
                ],
                edges: [],
              },
            }),
          },
          modelParamsProvider: {
            prepare: vi.fn().mockResolvedValue({
              success: false as const,
              reason: "provider_not_enabled",
              message:
                "Provider 'openai' is not enabled for this project. Enable it in Settings > Model Providers.",
            }),
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.reason).toBe("provider_not_enabled");
          expect(result.error).toContain("not enabled");
        }
      });
    });

    describe("when a workflow node's llm parameter is pinned to a codex model", () => {
      // Issue #6634, AC7(b): the platform-key fix for workflow.api_key must
      // not touch per-node credentials — a node that was ALREADY correctly
      // refused for using a restricted model outside its allowed surface
      // must still be refused, and the refusal must name that node's
      // model, not a generic failure.
      const CODEX_NODE_MODEL = "openai_codex/gpt-5.6-terra";

      const codexNodeDsl = {
        workflow_id: "wf_1",
        nodes: [
          {
            id: "llm_call",
            type: "signature",
            data: {
              name: "LLM Call",
              parameters: [
                {
                  identifier: "llm",
                  type: "llm",
                  value: { model: CODEX_NODE_MODEL },
                },
              ],
            },
          },
        ],
        edges: [],
      };

      /**
       * Refuses exactly the codex model and nothing else, and builds the
       * refusal FROM the model it was asked about. A blanket-failure stub
       * stays green with the codex pin removed from the DSL — the simulator
       * and judge preparations fail on their own, and its hard-coded message
       * still names a model nothing in the workflow pinned.
       */
      const modelAwarePrepare = vi.fn(
        async (
          _projectId: string,
          model: string,
        ): Promise<ModelParamsResult> =>
          model === CODEX_NODE_MODEL
            ? {
                success: false,
                reason: "preparation_error",
                message: `"${model}" serves the coding-assistant surfaces only and cannot run workflows, evaluations or the playground.`,
              }
            : {
                success: true,
                params: { api_key: "sk-usable", model },
              },
      );

      /** @scenario "A workflow node still pinned to a restricted model correctly fails" */
      it("returns a structured failure naming the codex model, not a silent pass", async () => {
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: codexNodeDsl,
            }),
          },
          modelParamsProvider: { prepare: modelAwarePrepare },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(modelAwarePrepare).toHaveBeenCalledWith(
          defaultContext.projectId,
          CODEX_NODE_MODEL,
        );
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.reason).toBe("preparation_error");
          expect(result.error).toContain(CODEX_NODE_MODEL);
        }
      });
    });

    describe("when the DSL has two signature nodes with different llm models", () => {
      // Test B: multi-model dedup — prepare called once per unique model
      it("calls prepare exactly twice for two nodes with different models", async () => {
        const prepareFn = vi.fn().mockResolvedValue({
          success: true as const,
          params: { model: "openai/gpt-4o-mini", api_key: "sk-key-a" },
        });

        const multiModelDsl = {
          workflow_id: "wf_1",
          nodes: [
            {
              id: "llm_a",
              type: "signature",
              data: {
                name: "LLM A",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: { model: "openai/gpt-4o-mini" },
                  },
                ],
              },
            },
            {
              id: "llm_b",
              type: "signature",
              data: {
                name: "LLM B",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: { model: "azure/gpt-4o-mini" },
                  },
                ],
              },
            },
          ],
          edges: [],
        };

        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: multiModelDsl,
            }),
          },
          modelParamsProvider: {
            prepare: prepareFn,
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        // Two distinct models → prepare called exactly twice (once for LLM provider model params)
        // Note: prefetchScenarioData also calls prepare for the scenario-level model params
        // so we check the workflow-level prepare calls via the models passed
        const workflowModels = prepareFn.mock.calls
          .map((call) => call[1] as string)
          .filter(
            (m) => m === "openai/gpt-4o-mini" || m === "azure/gpt-4o-mini",
          );
        expect(workflowModels).toHaveLength(2);
        expect(workflowModels).toContain("openai/gpt-4o-mini");
        expect(workflowModels).toContain("azure/gpt-4o-mini");

        // Verify result is successful (both models resolved)
        expect(result.success).toBe(true);
      });

      it("calls prepare only once for two nodes sharing the same model", async () => {
        const prepareFn = vi.fn().mockResolvedValue({
          success: true as const,
          params: { model: "openai/gpt-4o-mini", api_key: "sk-key-a" },
        });

        const sameModelDsl = {
          workflow_id: "wf_1",
          nodes: [
            {
              id: "llm_a",
              type: "signature",
              data: {
                name: "LLM A",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: { model: "openai/gpt-4o-mini" },
                  },
                ],
              },
            },
            {
              id: "llm_b",
              type: "signature",
              data: {
                name: "LLM B",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: { model: "openai/gpt-4o-mini" },
                  },
                ],
              },
            },
          ],
          edges: [],
        };

        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: sameModelDsl,
            }),
          },
          modelParamsProvider: {
            prepare: prepareFn,
          },
        });

        await prefetchScenarioData(defaultContext, workflowTarget, deps);

        // Both nodes share "openai/gpt-4o-mini" → prepare called exactly once for that model
        const workflowModelCalls = prepareFn.mock.calls
          .map((call) => call[1] as string)
          .filter((m) => m === "openai/gpt-4o-mini");
        expect(workflowModelCalls).toHaveLength(1);
      });
    });

    describe("when the DSL has no default_llm and the signature node has no value.model", () => {
      // Test C: falls back to DEFAULT_MODEL when both default_llm and param.value.model are absent
      it("calls prepare with DEFAULT_MODEL and hydrates litellm_params onto the param", async () => {
        const hydratedApiKey = "sk-default-model-key";

        const prepareFn = vi.fn().mockResolvedValue({
          success: true as const,
          params: { model: DEFAULT_MODEL, api_key: hydratedApiKey },
        });

        const noDefaultLlmDsl = {
          workflow_id: "wf_1",
          // default_llm absent (undefined)
          nodes: [
            {
              id: "llm_call",
              type: "signature",
              data: {
                name: "LLM Call",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: undefined, // no model set
                  },
                ],
              },
            },
          ],
          edges: [],
        };

        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: noDefaultLlmDsl,
            }),
          },
          modelParamsProvider: {
            prepare: prepareFn,
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        // prepare must be called with DEFAULT_MODEL for the workflow node
        const workflowModelCall = prepareFn.mock.calls.find(
          (call) => (call[1] as string) === DEFAULT_MODEL,
        );
        expect(workflowModelCall).toBeDefined();

        // litellm_params must be hydrated on the node
        expect(result.success).toBe(true);
        if (result.success && result.data.adapterData.type === "workflow") {
          const nodes = result.data.adapterData.workflow.nodes as Array<
            Record<string, unknown>
          >;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;
          const parameters = (signatureNode?.data as Record<string, unknown>)
            ?.parameters as Array<Record<string, unknown>> | undefined;
          const llmParam = parameters?.find(
            (p) => p.identifier === "llm" && p.type === "llm",
          );
          const litellmParams = (llmParam?.value as Record<string, unknown>)
            ?.litellm_params as Record<string, unknown> | undefined;
          expect(litellmParams?.api_key).toBe(hydratedApiKey);
        }
      });
    });

    describe("when the llm parameter value is a partial object without a top-level model key", () => {
      // Regression: existingValue like { temperature: 0.7 } (no `model` field) must still
      // produce an emitted value with a top-level `model`, matching addEnvs.ts behaviour.
      // Downstream NLP reads value.model directly; missing it causes runtime failure.
      it("guarantees a top-level model key in the emitted llm value", async () => {
        const prepareFn = vi.fn().mockResolvedValue({
          success: true as const,
          params: { model: DEFAULT_MODEL, api_key: "sk-partial" },
        });

        const partialValueDsl = {
          workflow_id: "wf_1",
          nodes: [
            {
              id: "llm_call",
              type: "signature",
              data: {
                name: "LLM Call",
                parameters: [
                  {
                    identifier: "llm",
                    type: "llm",
                    value: { temperature: 0.7 },
                  },
                ],
              },
            },
          ],
          edges: [],
        };

        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi.fn().mockResolvedValue({
              workflowId: "wf_1",
              dsl: partialValueDsl,
            }),
          },
          modelParamsProvider: {
            prepare: prepareFn,
          },
        });

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (result.success && result.data.adapterData.type === "workflow") {
          const nodes = result.data.adapterData.workflow.nodes as Array<
            Record<string, unknown>
          >;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;
          const parameters = (signatureNode?.data as Record<string, unknown>)
            ?.parameters as Array<Record<string, unknown>> | undefined;
          const llmParam = parameters?.find(
            (p) => p.identifier === "llm" && p.type === "llm",
          );
          const value = llmParam?.value as Record<string, unknown> | undefined;

          expect(value?.model).toBe(DEFAULT_MODEL);
          expect(value?.temperature).toBe(0.7);
        }
      });
    });

    describe("spec-version gating of the legacy default fallback", () => {
      // Nodes own their model since spec_version 1.5: a modelless llm param
      // on a modern DSL is stale state that must NOT be silently substituted
      // with DEFAULT_MODEL — it stays unhydrated so the engine raises its
      // typed llm_model_not_set error. The comparison is component-wise, so
      // a hypothetical "1.10" is newer than "1.5", not parseFloat's 1.1.
      const modellessDsl = (spec_version: string) => ({
        spec_version,
        workflow_id: "wf_1",
        nodes: [
          {
            id: "llm_call",
            type: "signature",
            data: {
              name: "LLM Call",
              parameters: [
                { identifier: "llm", type: "llm", value: undefined },
              ],
            },
          },
        ],
        edges: [],
      });

      const setupFor = (dsl: Record<string, unknown>) => {
        const prepareFn = vi.fn().mockResolvedValue(defaultModelParamsResult);
        const deps = createMockDeps({
          agentFetcher: {
            findById: vi.fn().mockResolvedValue(workflowAgent),
          },
          workflowVersionFetcher: {
            getLatestDsl: vi
              .fn()
              .mockResolvedValue({ workflowId: "wf_1", dsl }),
          },
          modelParamsProvider: { prepare: prepareFn },
        });
        return { deps, prepareFn };
      };

      it.each([
        "1.5",
        "1.10",
      ])("does not inject DEFAULT_MODEL on a %s DSL with a modelless llm param", async (specVersion) => {
        const { deps, prepareFn } = setupFor(modellessDsl(specVersion));

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(true);
        expect(
          prepareFn.mock.calls.some(
            (call) => (call[1] as string) === DEFAULT_MODEL,
          ),
        ).toBe(false);
      });

      it("still falls back to DEFAULT_MODEL on a 1.4 DSL", async () => {
        const { deps, prepareFn } = setupFor(modellessDsl("1.4"));

        const result = await prefetchScenarioData(
          defaultContext,
          workflowTarget,
          deps,
        );

        expect(result.success).toBe(true);
        expect(
          prepareFn.mock.calls.some(
            (call) => (call[1] as string) === DEFAULT_MODEL,
          ),
        ).toBe(true);
      });
    });
  });

  describe("given a run that resolved parameter values", () => {
    const promptTarget: TargetConfig = {
      type: "prompt",
      referenceId: "prompt_123",
    };

    function depsForScenario(scenario: Record<string, unknown>) {
      return createMockDeps({
        scenarioFetcher: { getById: vi.fn().mockResolvedValue(scenario) },
        promptFetcher: {
          getPromptByIdOrHandle: vi.fn().mockResolvedValue({
            id: "prompt_123",
            prompt: "You are helpful",
            messages: [],
            model: "openai/gpt-4",
          }),
        },
      });
    }

    describe("given a scenario whose text reads a parameter", () => {
      const parameterisedScenario = {
        ...defaultScenario,
        situation: "A {{ params.account_tier }} customer asks for a refund",
        criteria: ["Offers the {{ params.account_tier }} refund window"],
        parameters: [
          { name: "account_tier", defaultValue: "gold" },
          { name: "region", defaultValue: "eu-central" },
        ],
      };

      /** @scenario "Situation and criteria render params references before the simulated user and judge see them" */
      it("hands on a situation and criteria already rendered against the run's values", async () => {
        const deps = depsForScenario(parameterisedScenario);

        const result = await prefetchScenarioData(
          { ...defaultContext, parameters: { account_tier: "platinum" } },
          promptTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.scenario.situation).toBe(
          "A platinum customer asks for a refund",
        );
        expect(result.data.scenario.criteria).toEqual([
          "Offers the platinum refund window",
        ]);
      });

      /** @scenario "Situation and criteria render params references before the simulated user and judge see them" */
      it("carries the resolved values on the job", async () => {
        const deps = depsForScenario(parameterisedScenario);

        const result = await prefetchScenarioData(
          { ...defaultContext, parameters: { account_tier: "platinum" } },
          promptTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.parameters).toEqual({
          account_tier: "platinum",
          region: "eu-central",
        });
      });

      it("falls back to the declared defaults when the job carries no values", async () => {
        const deps = depsForScenario(parameterisedScenario);

        const result = await prefetchScenarioData(
          defaultContext,
          promptTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.parameters).toEqual({
          account_tier: "gold",
          region: "eu-central",
        });
        expect(result.data.scenario.situation).toBe(
          "A gold customer asks for a refund",
        );
      });
    });

    describe("given a scenario that declares none", () => {
      /** @scenario "A scenario without parameters renders byte-identical to its stored text" */
      it("hands its text on byte-identical", async () => {
        const situation = "The customer writes {{ and {% in their message";
        const deps = depsForScenario({
          ...defaultScenario,
          situation,
          criteria: ["Repeats {% verbatim"],
        });

        const result = await prefetchScenarioData(
          defaultContext,
          promptTarget,
          deps,
        );

        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.data.scenario.situation).toBe(situation);
        expect(result.data.scenario.criteria).toEqual(["Repeats {% verbatim"]);
        expect(result.data.parameters).toEqual({});
      });
    });

    describe("given the scenario changed under a queued run", () => {
      it("fails loudly rather than running against an unrendered reference", async () => {
        const deps = depsForScenario({
          ...defaultScenario,
          situation: "A {{ params.account_tier }} customer asks for a refund",
          parameters: [{ name: "account_tier" }],
        });

        await expect(
          prefetchScenarioData(defaultContext, promptTarget, deps),
        ).rejects.toThrow(/could not be rendered/);
      });
    });
  });

  describe("given an http target and a project holding secrets", () => {
    /** @scenario "The http prefetch loads project secrets for the run" */
    it("loads the project's secrets so the target can reference them", async () => {
      const deps = createMockDeps({
        agentFetcher: {
          findById: vi.fn().mockResolvedValue({
            id: "agent_http",
            type: "http",
            config: { url: "https://api.test/chat", method: "POST" },
          }),
        },
        projectSecretsFetcher: {
          getSecrets: vi.fn().mockResolvedValue({ AGENT_TOKEN: "tok-123" }),
        },
      });

      const result = await prefetchScenarioData(
        defaultContext,
        { type: "http", referenceId: "agent_http" },
        deps,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.adapterData).toMatchObject({
        type: "http",
        secrets: { AGENT_TOKEN: "tok-123" },
      });
    });
  });
});
