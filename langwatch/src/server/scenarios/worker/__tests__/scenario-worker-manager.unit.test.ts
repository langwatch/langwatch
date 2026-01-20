/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  ScenarioWorkerManager,
  type ScenarioWorkerManagerDeps,
} from "../scenario-worker-manager";

// Mock dependencies
vi.mock("node:worker_threads", () => ({
  Worker: vi.fn(),
}));

vi.mock("../../../api/routers/modelProviders", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    BASE_HOST: "http://localhost:3000",
    LANGWATCH_NLP_SERVICE: "http://localhost:8080",
  },
}));

// Mock missing generated types
vi.mock("../../../tracer/types.generated", () => ({
  baseSpanSchema: {},
  chatMessageSchema: {},
}));

vi.mock("../../../datasets/types", () => ({
  datasetColumnTypeSchema: { optional: () => ({ default: () => ({}) }) },
}));

import { Worker } from "node:worker_threads";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../../api/routers/modelProviders";

const mockGetProjectModelProviders = vi.mocked(getProjectModelProviders);
const mockPrepareLitellmParams = vi.mocked(prepareLitellmParams);
const MockWorker = vi.mocked(Worker);

describe("ScenarioWorkerManager", () => {
  let manager: ScenarioWorkerManager;
  let mockDeps: ScenarioWorkerManagerDeps;
  let mockScenarioService: { getById: Mock };
  let mockPromptService: { getPromptByIdOrHandle: Mock };
  let mockAgentRepository: { findById: Mock };
  let mockPrisma: { project: { findUnique: Mock } };

  beforeEach(() => {
    vi.clearAllMocks();

    mockScenarioService = {
      getById: vi.fn(),
    };

    mockPromptService = {
      getPromptByIdOrHandle: vi.fn(),
    };

    mockAgentRepository = {
      findById: vi.fn(),
    };

    mockPrisma = {
      project: {
        findUnique: vi.fn(),
      },
    };

    mockDeps = {
      scenarioService: mockScenarioService as unknown as ScenarioWorkerManagerDeps["scenarioService"],
      promptService: mockPromptService as unknown as ScenarioWorkerManagerDeps["promptService"],
      agentRepository: mockAgentRepository as unknown as ScenarioWorkerManagerDeps["agentRepository"],
      prisma: mockPrisma as unknown as ScenarioWorkerManagerDeps["prisma"],
    };

    manager = new ScenarioWorkerManager(mockDeps);

    // Default mock implementations
    mockGetProjectModelProviders.mockResolvedValue({
      openai: { enabled: true, provider: "openai" },
    } as unknown as ReturnType<typeof getProjectModelProviders> extends Promise<infer T> ? T : never);

    mockPrepareLitellmParams.mockResolvedValue({
      api_key: "test-key",
      model: "openai/gpt-4",
    });
  });

  describe("execute", () => {
    it("returns error result when scenario is not found", async () => {
      mockScenarioService.getById.mockResolvedValue(null);

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_nonexistent",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error result when project has no API key", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const result = await manager.execute({
        projectId: "proj_nonexistent",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found or has no API key");
    });

    it("returns error result when model provider is disabled", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockGetProjectModelProviders.mockResolvedValue({
        openai: { enabled: false, provider: "openai" },
      } as unknown as ReturnType<typeof getProjectModelProviders> extends Promise<infer T> ? T : never);

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured or disabled");
    });

    it("returns error result when prompt is not found", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockPromptService.getPromptByIdOrHandle.mockResolvedValue(null);

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_nonexistent" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Prompt");
      expect(result.error).toContain("not found");
    });

    it("returns error result when HTTP agent is not found", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockAgentRepository.findById.mockResolvedValue(null);

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "http", referenceId: "agent_nonexistent" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP agent");
      expect(result.error).toContain("not found");
    });

    it("returns error result when agent is not HTTP type", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockAgentRepository.findById.mockResolvedValue({
        id: "agent_123",
        type: "custom",
        config: {},
      });

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "http", referenceId: "agent_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not an HTTP agent");
    });

    it("returns error result when LiteLLM params are invalid", async () => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test",
        situation: "Test situation",
        criteria: [],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockPrepareLitellmParams.mockResolvedValue({
        // Missing required fields
        some_field: "value",
      });

      const result = await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid LiteLLM params");
    });
  });

  describe("prepareWorkerData for prompt target", () => {
    beforeEach(() => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test Scenario",
        situation: "Test situation",
        criteria: ["Be helpful", "Be accurate"],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockPromptService.getPromptByIdOrHandle.mockResolvedValue({
        prompt: "You are a helpful assistant.",
        messages: [
          { role: "system", content: "System message" },
          { role: "user", content: "Example user" },
          { role: "assistant", content: "Example assistant" },
        ],
        model: "openai/gpt-4",
        temperature: 0.7,
        maxTokens: 1000,
      });

      // Setup worker mock to capture workerData
      MockWorker.mockImplementation((_path, options) => {
        const workerData = options?.workerData;
        // Simulate successful execution
        setTimeout(() => {
          const mockWorker = MockWorker.mock.results[0]?.value;
          if (mockWorker) {
            const messageHandler = mockWorker.on.mock.calls.find(
              (call: unknown[]) => call[0] === "message",
            )?.[1];
            if (messageHandler) {
              messageHandler({
                type: "result",
                data: { success: true, runId: "run_123" },
              });
            }
          }
        }, 0);

        return {
          on: vi.fn(),
          postMessage: vi.fn(),
          terminate: vi.fn(),
          threadId: 1,
        } as unknown as Worker;
      });
    });

    it("fetches scenario from scenarioService", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(mockScenarioService.getById).toHaveBeenCalledWith({
        projectId: "proj_123",
        id: "scen_123",
      });
    });

    it("fetches project from prisma", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: "proj_123" },
        select: { apiKey: true, defaultModel: true },
      });
    });

    it("fetches prompt from promptService", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(mockPromptService.getPromptByIdOrHandle).toHaveBeenCalledWith({
        idOrHandle: "prompt_123",
        projectId: "proj_123",
      });
    });

    it("prepares LiteLLM params for default and target models", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "prompt", referenceId: "prompt_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      // Called twice: once for default model, once for prompt's model
      expect(mockPrepareLitellmParams).toHaveBeenCalledTimes(2);
    });
  });

  describe("prepareWorkerData for HTTP target", () => {
    beforeEach(() => {
      mockScenarioService.getById.mockResolvedValue({
        id: "scen_123",
        name: "Test Scenario",
        situation: "Test situation",
        criteria: ["Be helpful"],
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        apiKey: "api_key_123",
        defaultModel: "openai/gpt-4",
      });
      mockAgentRepository.findById.mockResolvedValue({
        id: "agent_123",
        type: "http",
        config: {
          url: "https://api.example.com",
          method: "POST",
          headers: [{ key: "X-Custom", value: "value" }],
          auth: { type: "bearer", token: "token" },
          bodyTemplate: '{"input": "{{input}}"}',
          outputPath: "$.response",
        },
      });

      MockWorker.mockImplementation(() => {
        const mockWorker = {
          on: vi.fn(),
          postMessage: vi.fn(),
          terminate: vi.fn(),
          threadId: 1,
        };

        setTimeout(() => {
          const messageHandler = mockWorker.on.mock.calls.find(
            (call: unknown[]) => call[0] === "message",
          )?.[1];
          if (messageHandler) {
            messageHandler({
              type: "result",
              data: { success: true },
            });
          }
        }, 0);

        return mockWorker as unknown as Worker;
      });
    });

    it("fetches agent from agentRepository", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "http", referenceId: "agent_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      expect(mockAgentRepository.findById).toHaveBeenCalledWith({
        id: "agent_123",
        projectId: "proj_123",
      });
    });

    it("only prepares LiteLLM params for default model (not target)", async () => {
      await manager.execute({
        projectId: "proj_123",
        scenarioId: "scen_123",
        target: { type: "http", referenceId: "agent_123" },
        setId: "set_123",
        batchRunId: "batch_123",
      });

      // Called only once for default model (HTTP agents don't need LLM params)
      expect(mockPrepareLitellmParams).toHaveBeenCalledTimes(1);
    });
  });

  describe("static create factory", () => {
    it("creates manager with default dependencies", () => {
      const mockPrismaFull = {
        project: { findUnique: vi.fn() },
      };

      // This would fail if ScenarioService.create etc. were not properly mocked
      // For now we just verify it doesn't throw
      expect(() =>
        ScenarioWorkerManager.create(mockPrismaFull as never),
      ).not.toThrow();
    });

    it("allows partial dependency injection", () => {
      const customScenarioService = { getById: vi.fn() };

      expect(() =>
        ScenarioWorkerManager.create(mockPrisma as never, {
          scenarioService: customScenarioService as unknown as ScenarioWorkerManagerDeps["scenarioService"],
        }),
      ).not.toThrow();
    });
  });
});
