/**
 * @vitest-environment node
 *
 * Unit tests for ScenarioExecutionOrchestrator.
 *
 * These tests use test doubles (stubs/fakes) to verify BEHAVIOR,
 * not mock call verification. Each test follows Given-When-Then.
 */

import { describe, expect, it } from "vitest";
import { ScenarioExecutionOrchestrator } from "../execution/orchestrator";
import type {
  AdapterFactory,
  ModelParamsProvider,
  OrchestratorDependencies,
  ProjectRepository,
  ScenarioExecutor,
  ScenarioRepository,
  TracerFactory,
} from "../execution/orchestrator.types";
import type { LiteLLMParams, ScenarioConfig } from "../execution/types";

// Test doubles that record state for verification
function createTestDeps(overrides?: Partial<OrchestratorDependencies>): OrchestratorDependencies {
  const defaultScenario: ScenarioConfig = {
    id: "scen_123",
    name: "Test Scenario",
    situation: "User asks a question",
    criteria: ["Must respond politely"],
    labels: [],
  };

  const defaultProject = {
    apiKey: "test-api-key",
    defaultModel: "openai/gpt-4o-mini",
  };

  const defaultParams: LiteLLMParams = {
    api_key: "test-key",
    model: "openai/gpt-4o-mini",
  };

  let shutdownCalled = false;

  return {
    scenarioRepository: {
      getById: async () => defaultScenario,
    },
    projectRepository: {
      getProject: async () => defaultProject,
    },
    modelParamsProvider: {
      prepare: async () => ({ success: true as const, params: defaultParams }),
    },
    adapterFactory: {
      create: async () => ({
        success: true as const,
        adapter: { name: "TestAdapter", role: "Agent", call: async () => "response" } as any,
      }),
    },
    tracerFactory: {
      create: () => ({
        shutdown: async () => { shutdownCalled = true; },
      }),
    },
    scenarioExecutor: {
      run: async () => ({
        success: true,
        runId: "run_123",
        reasoning: "All criteria met",
      }),
    },
    nlpServiceUrl: "http://localhost:8080",
    telemetryEndpoint: "http://localhost:3000",
    ...overrides,
  };
}

describe("ScenarioExecutionOrchestrator", () => {
  const defaultInput = {
    context: {
      projectId: "proj_123",
      scenarioId: "scen_123",
      setId: "set_123",
      batchRunId: "batch_123",
    },
    target: { type: "prompt" as const, referenceId: "prompt_123" },
  };

  describe("execute", () => {
    describe("given all dependencies return valid data", () => {
      describe("when executing a scenario", () => {
        it("returns success with runId and reasoning", async () => {
          const deps = createTestDeps();
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(true);
          expect(result.runId).toBe("run_123");
          expect(result.reasoning).toBe("All criteria met");
        });
      });
    });

    describe("given scenario does not exist", () => {
      describe("when executing", () => {
        it("returns failure with scenario not found error", async () => {
          const deps = createTestDeps({
            scenarioRepository: { getById: async () => null },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toContain("Scenario");
          expect(result.error).toContain("not found");
        });
      });
    });

    describe("given project does not exist", () => {
      describe("when executing", () => {
        it("returns failure with project not found error", async () => {
          const deps = createTestDeps({
            projectRepository: { getProject: async () => null },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toContain("Project");
          expect(result.error).toContain("not found");
        });
      });
    });

    describe("given project has no default model configured", () => {
      describe("when executing", () => {
        it("returns failure with clear error message", async () => {
          const deps = createTestDeps({
            projectRepository: {
              getProject: async () => ({ apiKey: "test-api-key", defaultModel: null }),
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toBe("Project default model is not configured");
        });
      });
    });

    describe("given model params cannot be prepared", () => {
      describe("when executing", () => {
        it("returns failure with model params error", async () => {
          const deps = createTestDeps({
            modelParamsProvider: {
              prepare: async () => ({
                success: false as const,
                reason: "provider_not_found" as const,
                message: "Provider 'openai' not found for this project",
              }),
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toContain("Provider 'openai' not found");
        });
      });
    });

    describe("given adapter creation fails", () => {
      describe("when executing", () => {
        it("returns failure with adapter error message", async () => {
          const deps = createTestDeps({
            adapterFactory: {
              create: async () => ({ success: false as const, error: "Prompt not found" }),
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toBe("Prompt not found");
        });
      });
    });

    describe("given scenario executor throws an error", () => {
      describe("when executing", () => {
        it("returns failure with error message", async () => {
          const deps = createTestDeps({
            scenarioExecutor: {
              run: async () => { throw new Error("SDK crashed"); },
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(false);
          expect(result.error).toBe("SDK crashed");
        });

        it("still shuts down tracer", async () => {
          let tracerShutdownCalled = false;
          const deps = createTestDeps({
            tracerFactory: {
              create: () => ({
                shutdown: async () => { tracerShutdownCalled = true; },
              }),
            },
            scenarioExecutor: {
              run: async () => { throw new Error("Execution failed"); },
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          await orchestrator.execute(defaultInput);

          expect(tracerShutdownCalled).toBe(true);
        });
      });
    });

    describe("given tracer shutdown fails", () => {
      describe("when executing", () => {
        it("returns success (shutdown failure does not affect result)", async () => {
          const deps = createTestDeps({
            tracerFactory: {
              create: () => ({
                shutdown: async () => { throw new Error("Shutdown failed"); },
              }),
            },
          });
          const orchestrator = new ScenarioExecutionOrchestrator(deps);

          const result = await orchestrator.execute(defaultInput);

          expect(result.success).toBe(true);
        });
      });
    });
  });
});
