/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { generateText } from "ai";
import ScenarioRunner from "@langwatch/scenario";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { SimulationRunnerService } from "../simulation-runner.service";
import { ScenarioService } from "../scenario.service";
import { PromptService } from "../../prompt-config/prompt.service";

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

// Mock @langwatch/scenario SDK to prevent its internal LLM calls
// while still testing our adapter integration
vi.mock("@langwatch/scenario", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/scenario")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      run: vi.fn(async (config: { agents: Array<{ call?: (input: unknown) => Promise<string> }> }) => {
        // Simulate SDK behavior: call the adapter agent if present
        const adapter = config.agents.find(
          (a) => a.call && typeof a.call === "function"
        );
        if (adapter?.call) {
          await adapter.call({
            messages: [{ role: "user", content: "Hello" }],
          });
        }
        return { success: true, reasoning: "Mocked result" };
      }),
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
    runnerService = SimulationRunnerService.create(prisma);
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

    // 4. Execute the scenario
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

    // 5. Verify generateText was called at least once
    expect(mockGenerateText).toHaveBeenCalled();

    // 6. Find the call made by our adapter (should have system prompt from our prompt config)
    const adapterCall = mockGenerateText.mock.calls.find((call) => {
      const messages = call[0]?.messages as Array<{
        role: string;
        content: string;
      }>;
      return (
        messages?.some(
          (m) => m.role === "system" && m.content === "You are a helpful assistant.",
        )
      );
    });

    expect(adapterCall).toBeDefined();
    const callArgs = adapterCall?.[0];
    expect(callArgs?.model).toBeDefined();
    expect(callArgs?.messages).toBeDefined();
    expect(Array.isArray(callArgs?.messages)).toBe(true);
    expect(callArgs?.temperature).toBe(0.7);
    expect(callArgs?.maxOutputTokens).toBe(100);
  });

  it("handles missing scenario gracefully", async () => {
    const prompt = await promptService.createPrompt({
      projectId,
      handle: "test-prompt-2",
      prompt: "You are a helpful assistant.",
      model: "openai/gpt-4o-mini",
    });

    // Execute with non-existent scenario ID
    await runnerService.execute({
      projectId,
      scenarioId: "scen_nonexistent",
      target: {
        type: "prompt",
        referenceId: prompt.id,
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // Should not call generateText if scenario doesn't exist
    expect(mockGenerateText).not.toHaveBeenCalled();
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
    // Note: execute() catches errors and logs them, so it doesn't throw
    await runnerService.execute({
      projectId,
      scenarioId: scenario.id,
      target: {
        type: "prompt",
        referenceId: "nonexistent-prompt-id",
      },
      setId: "test-set-id",
      batchRunId: "scenariobatch_test123",
    });

    // The error should be caught and logged, but execution should complete
    // We can verify that generateText was not called successfully
    // (it may have been called but failed, so we check that no successful calls were made)
    const successfulCalls = mockGenerateText.mock.calls.filter((call) => {
      // A successful call would have valid messages
      const messages = call[0]?.messages;
      return messages && Array.isArray(messages) && messages.length > 0;
    });
    // Should not have any successful calls since prompt doesn't exist
    expect(successfulCalls.length).toBe(0);
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
      criteria: [],
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

    // Verify ScenarioRunner.run was called with an adapter
    expect(mockScenarioRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: scenario.id,
        name: scenario.name,
        agents: expect.arrayContaining([
          expect.objectContaining({ role: "Agent" }), // PromptConfigAdapter
        ]),
      }),
      expect.objectContaining({
        batchRunId: "scenariobatch_test123",
      })
    );
  });
});

