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
  prefetchScenarioData,
  type DataPrefetcherDependencies,
  type ScenarioFetcher,
  type PromptFetcher,
  type AgentFetcher,
  type ProjectFetcher,
  type ModelParamsProvider,
  type WorkflowVersionFetcher,
  type ProjectSecretsFetcher,
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

    return {
      scenarioFetcher,
      promptFetcher,
      agentFetcher,
      workflowVersionFetcher,
      projectFetcher,
      modelParamsProvider,
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

          const target: TargetConfig = { type: "code", referenceId: "agent_456" };
          const result = await prefetchScenarioData(defaultContext, target, deps);

          expect(projectSecretsFetcher.getSecrets).toHaveBeenCalledWith("proj_123");
          expect(result.success).toBe(true);
          // Assert explicitly before narrowing so a type drift fails loudly
          // instead of silently skipping the toEqual below.
          if (!result.success) throw new Error("prefetch should have succeeded");
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
        it("returns success with complete data", async () => {
          // The source reads process.env.LANGWATCH_ENDPOINT directly (not via env.mjs)
          const previousLangwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
          process.env.LANGWATCH_ENDPOINT = "http://localhost:3000";

          try {
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
          } finally {
            if (previousLangwatchEndpoint === undefined) {
              delete process.env.LANGWATCH_ENDPOINT;
            } else {
              process.env.LANGWATCH_ENDPOINT = previousLangwatchEndpoint;
            }
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
          const nodes = result.data.adapterData.workflow.nodes as Array<Record<string, unknown>>;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;

          expect(signatureNode).toBeDefined();

          const data = signatureNode?.data as Record<string, unknown> | undefined;
          const parameters = data?.parameters as Array<Record<string, unknown>> | undefined;
          const llmParam = parameters?.find(
            (p) => p.identifier === "llm" && p.type === "llm",
          );

          expect(llmParam).toBeDefined();

          // The value must be hydrated — not undefined and not using the dummy key
          const value = llmParam?.value as Record<string, unknown> | undefined;
          expect(value).toBeDefined();
          expect(value?.litellm_params).toBeDefined();

          const litellmParams = value?.litellm_params as Record<string, unknown> | undefined;
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
              message: "Provider 'openai' is not enabled for this project. Enable it in Settings > Model Providers.",
            }),
          },
        });

        const result = await prefetchScenarioData(defaultContext, workflowTarget, deps);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.reason).toBe("provider_not_enabled");
          expect(result.error).toContain("not enabled");
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
                  { identifier: "llm", type: "llm", value: { model: "openai/gpt-4o-mini" } },
                ],
              },
            },
            {
              id: "llm_b",
              type: "signature",
              data: {
                name: "LLM B",
                parameters: [
                  { identifier: "llm", type: "llm", value: { model: "azure/gpt-4o-mini" } },
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

        const result = await prefetchScenarioData(defaultContext, workflowTarget, deps);

        // Two distinct models → prepare called exactly twice (once for LLM provider model params)
        // Note: prefetchScenarioData also calls prepare for the scenario-level model params
        // so we check the workflow-level prepare calls via the models passed
        const workflowModels = prepareFn.mock.calls
          .map((call) => call[1] as string)
          .filter((m) => m === "openai/gpt-4o-mini" || m === "azure/gpt-4o-mini");
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
                  { identifier: "llm", type: "llm", value: { model: "openai/gpt-4o-mini" } },
                ],
              },
            },
            {
              id: "llm_b",
              type: "signature",
              data: {
                name: "LLM B",
                parameters: [
                  { identifier: "llm", type: "llm", value: { model: "openai/gpt-4o-mini" } },
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

        const result = await prefetchScenarioData(defaultContext, workflowTarget, deps);

        // prepare must be called with DEFAULT_MODEL for the workflow node
        const workflowModelCall = prepareFn.mock.calls.find(
          (call) => (call[1] as string) === DEFAULT_MODEL,
        );
        expect(workflowModelCall).toBeDefined();

        // litellm_params must be hydrated on the node
        expect(result.success).toBe(true);
        if (result.success && result.data.adapterData.type === "workflow") {
          const nodes = result.data.adapterData.workflow.nodes as Array<Record<string, unknown>>;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;
          const parameters = (signatureNode?.data as Record<string, unknown>)?.parameters as Array<Record<string, unknown>> | undefined;
          const llmParam = parameters?.find((p) => p.identifier === "llm" && p.type === "llm");
          const litellmParams = (llmParam?.value as Record<string, unknown>)?.litellm_params as Record<string, unknown> | undefined;
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

        const result = await prefetchScenarioData(defaultContext, workflowTarget, deps);

        expect(result.success).toBe(true);
        if (result.success && result.data.adapterData.type === "workflow") {
          const nodes = result.data.adapterData.workflow.nodes as Array<Record<string, unknown>>;
          const signatureNode = nodes.find(
            (n) => (n as { type?: unknown }).type === "signature",
          ) as Record<string, unknown> | undefined;
          const parameters = (signatureNode?.data as Record<string, unknown>)?.parameters as Array<Record<string, unknown>> | undefined;
          const llmParam = parameters?.find((p) => p.identifier === "llm" && p.type === "llm");
          const value = llmParam?.value as Record<string, unknown> | undefined;

          expect(value?.model).toBe(DEFAULT_MODEL);
          expect(value?.temperature).toBe(0.7);
        }
      });
    });

});
});
