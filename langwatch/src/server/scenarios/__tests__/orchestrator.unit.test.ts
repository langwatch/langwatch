/**
 * @vitest-environment node
 *
 * Unit tests for ScenarioExecutionOrchestrator.
 *
 * These tests use test doubles (stubs/fakes) to verify BEHAVIOR,
 * not mock call verification. Each test follows Given-When-Then.
 */

import { beforeEach, describe, expect, it } from "vitest";
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
      prepare: async () => defaultParams,
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
    it("returns success when all steps complete", async () => {
      // Given: all dependencies return valid data
      const deps = createTestDeps();
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing a scenario
      const result = await orchestrator.execute(defaultInput);

      // Then: returns successful result
      expect(result.success).toBe(true);
      expect(result.runId).toBe("run_123");
      expect(result.reasoning).toBe("All criteria met");
    });

    it("returns failure when scenario not found", async () => {
      // Given: scenario repository returns null
      const deps = createTestDeps({
        scenarioRepository: { getById: async () => null },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: returns failure with error message
      expect(result.success).toBe(false);
      expect(result.error).toContain("Scenario");
      expect(result.error).toContain("not found");
    });

    it("returns failure when project not found", async () => {
      // Given: project repository returns null
      const deps = createTestDeps({
        projectRepository: { getProject: async () => null },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: returns failure
      expect(result.success).toBe(false);
      expect(result.error).toContain("Project");
      expect(result.error).toContain("not found");
    });

    it("returns failure when model params cannot be prepared", async () => {
      // Given: model params provider returns null
      const deps = createTestDeps({
        modelParamsProvider: { prepare: async () => null },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: returns failure
      expect(result.success).toBe(false);
      expect(result.error).toContain("model params");
    });

    it("returns failure when adapter creation fails", async () => {
      // Given: adapter factory returns failure
      const deps = createTestDeps({
        adapterFactory: {
          create: async () => ({ success: false as const, error: "Prompt not found" }),
        },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: returns failure with adapter error
      expect(result.success).toBe(false);
      expect(result.error).toBe("Prompt not found");
    });

    it("returns failure when scenario execution throws", async () => {
      // Given: executor throws an error
      const deps = createTestDeps({
        scenarioExecutor: {
          run: async () => { throw new Error("SDK crashed"); },
        },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: returns failure with error message
      expect(result.success).toBe(false);
      expect(result.error).toBe("SDK crashed");
    });

    it("shuts down tracer even when execution fails", async () => {
      // Given: executor throws, but tracer should still be shut down
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

      // When: executing (will fail)
      await orchestrator.execute(defaultInput);

      // Then: tracer was still shut down
      expect(tracerShutdownCalled).toBe(true);
    });

    it("handles tracer shutdown failure gracefully", async () => {
      // Given: tracer shutdown throws
      const deps = createTestDeps({
        tracerFactory: {
          create: () => ({
            shutdown: async () => { throw new Error("Shutdown failed"); },
          }),
        },
      });
      const orchestrator = new ScenarioExecutionOrchestrator(deps);

      // When: executing
      const result = await orchestrator.execute(defaultInput);

      // Then: still returns success (shutdown failure doesn't affect result)
      expect(result.success).toBe(true);
    });
  });
});
