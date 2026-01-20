/**
 * @vitest-environment node
 *
 * Integration tests for scenario execution via the queue/processor.
 * Tests the full flow: SimulationRunnerService → Queue → Processor → ScenarioRunner
 *
 * Without Redis, QueueWithFallback runs the processor directly,
 * allowing us to test the full flow in isolation.
 */

import ScenarioRunner from "@langwatch/scenario";
import { generateText } from "ai";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { PromptService } from "../../prompt-config/prompt.service";
import { ScenarioService } from "../scenario.service";
import { SimulationRunnerService } from "../simulation-runner.service";

// Mock the AI SDK to avoid real LLM calls
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

// Mock getVercelAIModel to avoid model provider lookup (no API keys in CI)
vi.mock("../../modelProviders/utils", () => ({
  getVercelAIModel: vi.fn(() => Promise.resolve({ modelId: "test-model" })),
}));

// Mock model provider preparation
vi.mock("../../api/routers/modelProviders", () => ({
  getProjectModelProviders: vi.fn(() =>
    Promise.resolve({
      openai: {
        enabled: true,
        models: ["gpt-4o-mini"],
      },
    }),
  ),
  prepareLitellmParams: vi.fn(() =>
    Promise.resolve({
      model: "openai/gpt-4o-mini",
      api_key: "test-api-key",
    }),
  ),
}));

// Mock OTEL instrumentation to avoid trace setup in tests
vi.mock("../execution/instrumentation", () => ({
  createScenarioTracer: vi.fn(() => ({
    provider: {},
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock @langwatch/scenario SDK to prevent its internal LLM calls
// while still testing our adapter integration
vi.mock("@langwatch/scenario", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/scenario")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      run: vi.fn(
        async (config: {
          agents: Array<{ call?: (input: unknown) => Promise<string> }>;
        }) => {
          // Simulate SDK behavior: call the adapter agent if present
          const adapter = config.agents.find(
            (a) => a.call && typeof a.call === "function",
          );
          if (adapter?.call) {
            await adapter.call({
              messages: [{ role: "user", content: "Hello" }],
            });
          }
          return { success: true, runId: "run_123", reasoning: "Mocked result" };
        },
      ),
      userSimulatorAgent: vi.fn(() => ({ name: "UserSimulator" })),
      judgeAgent: vi.fn(() => ({ name: "JudgeAgent" })),
    },
  };
});

const mockGenerateText = vi.mocked(generateText);
const mockScenarioRun = ScenarioRunner.run as Mock;

describe("SimulationRunnerService Integration", () => {
  const projectId = "test-project-id";
  let runnerService: SimulationRunnerService;
  let scenarioService: ScenarioService;
  let promptService: PromptService;

  beforeAll(async () => {
    await getTestUser();
    runnerService = SimulationRunnerService.create();
    scenarioService = ScenarioService.create(prisma);
    promptService = new PromptService(prisma);
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.scenario.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId },
    });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });

    // Reset mocks
    vi.clearAllMocks();
  });

  it("executes a scenario against a prompt target", async () => {
    // 1. Create a prompt
    const prompt = await promptService.createPrompt({
      projectId,
      handle: "test-prompt",
      prompt: "You are a helpful assistant.",
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 100,
    });

    // 2. Create a scenario
    const scenario = await scenarioService.create({
      projectId,
      name: "Test Scenario",
      situation: "User asks a simple question",
      criteria: ["Agent responds helpfully"],
      labels: [],
    });

    // 3. Mock LLM response (may be called multiple times by scenario SDK)
    mockGenerateText.mockResolvedValue({
      text: "I'm here to help! How can I assist you today?",
    } as any);

    // 4. Execute the scenario (will run processor directly via QueueWithFallback)
    const result = await runnerService.execute({
      projectId,
      scenarioId: scenario.id,
      target: {
        type: "prompt",
        referenceId: prompt.id,
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // 5. Verify execution was scheduled successfully
    expect(result.success).toBe(true);

    // 6. Verify ScenarioRunner.run was called
    expect(mockScenarioRun).toHaveBeenCalled();

    // 7. Verify generateText was called at least once (via adapter)
    expect(mockGenerateText).toHaveBeenCalled();
  });

  it("handles missing scenario gracefully", async () => {
    const prompt = await promptService.createPrompt({
      projectId,
      handle: "test-prompt-2",
      prompt: "You are a helpful assistant.",
      model: "openai/gpt-4o-mini",
    });

    // Execute with non-existent scenario ID
    const result = await runnerService.execute({
      projectId,
      scenarioId: "scen_nonexistent",
      target: {
        type: "prompt",
        referenceId: prompt.id,
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // With the queue/processor architecture, the job is scheduled
    // but the processor will fail gracefully when scenario not found
    expect(result.success).toBe(true); // Scheduling succeeded

    // ScenarioRunner should not have been called
    expect(mockScenarioRun).not.toHaveBeenCalled();
  });

  it("handles missing prompt gracefully", async () => {
    const scenario = await scenarioService.create({
      projectId,
      name: "Test Scenario 2",
      situation: "User asks a question",
      criteria: [],
      labels: [],
    });

    // Execute with non-existent prompt ID
    const result = await runnerService.execute({
      projectId,
      scenarioId: scenario.id,
      target: {
        type: "prompt",
        referenceId: "nonexistent-prompt-id",
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // Scheduling succeeds, but processor fails when prompt not found
    expect(result.success).toBe(true);

    // ScenarioRunner should not have been called due to adapter creation failure
    expect(mockScenarioRun).not.toHaveBeenCalled();
  });

  it("resolves PromptConfigAdapter for prompt target type", async () => {
    const prompt = await promptService.createPrompt({
      projectId,
      handle: "test-prompt-adapter-resolution",
      prompt: "You are a helpful assistant.",
      model: "openai/gpt-4o-mini",
    });

    const scenario = await scenarioService.create({
      projectId,
      name: "Test Scenario Adapter",
      situation: "User asks a question",
      criteria: ["Responds politely"],
      labels: [],
    });

    mockGenerateText.mockResolvedValue({
      text: "Response",
    } as any);

    await runnerService.execute({
      projectId,
      scenarioId: scenario.id,
      target: {
        type: "prompt",
        referenceId: prompt.id,
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // Verify ScenarioRunner.run was called with correct scenario config
    expect(mockScenarioRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: scenario.id,
        name: scenario.name,
        description: scenario.situation,
      }),
      expect.objectContaining({
        batchRunId: "scenariobatch_test123",
      }),
    );

    // Verify judge was created with criteria
    expect(ScenarioRunner.judgeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: ["Responds politely"],
      }),
    );
  });
});
