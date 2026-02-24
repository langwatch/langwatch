import { type AgentInput, AgentRole } from "@langwatch/scenario";
import type { CoreMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptService } from "../../../prompt-config/prompt.service";
import { PromptConfigAdapter } from "../prompt-config.adapter";

const createAgentInput = (
  messages: CoreMessage[],
  overrides: Partial<AgentInput> = {},
): AgentInput => ({
  threadId: "test-thread-id",
  messages,
  newMessages: messages,
  requestedRole: AgentRole.AGENT,

  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
  ...overrides,
});

// Mock dependencies
vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "mocked response" }),
}));

vi.mock("../../../modelProviders/utils", () => ({
  getVercelAIModel: vi.fn().mockResolvedValue({ modelId: "test-model" }),
}));

const createMockPromptService = (
  promptData: Partial<{
    prompt: string;
    messages: Array<{ role: string; content: string }>;
    model: string;
    temperature: number;
    maxTokens: number;
  }> = {},
) => {
  return {
    getPromptByIdOrHandle: vi.fn().mockResolvedValue({
      prompt: "You are a helpful assistant.",
      messages: [],
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 100,
      ...promptData,
    }),
  } as unknown as PromptService;
};

describe("PromptConfigAdapter", () => {
  describe("when building messages", () => {
    it("places system prompt as first message", async () => {
      const { generateText } = await import("ai");
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockClear();

      const promptService = createMockPromptService({
        prompt: "You are a customer service agent.",
      });

      const adapter = new PromptConfigAdapter(
        "prompt-id",
        promptService,
        "project-id",
      );

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      const messages = callArgs?.messages as Array<{
        role: string;
        content: string;
      }>;

      expect(messages[0]).toEqual({
        role: "system",
        content: "You are a customer service agent.",
      });
    });

    it("filters system messages from prompt.messages", async () => {
      const { generateText } = await import("ai");
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockClear();

      const promptService = createMockPromptService({
        prompt: "System prompt",
        messages: [
          { role: "system", content: "Should be filtered" },
          { role: "user", content: "User message" },
        ],
      });

      const adapter = new PromptConfigAdapter(
        "prompt-id",
        promptService,
        "project-id",
      );

      await adapter.call(createAgentInput([]));

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      const messages = callArgs?.messages as Array<{
        role: string;
        content: string;
      }>;

      const systemMessages = messages.filter((m) => m.role === "system");
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0]?.content).toBe("System prompt");
    });

    it("appends input messages after prompt messages", async () => {
      const { generateText } = await import("ai");
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockClear();

      const promptService = createMockPromptService({
        prompt: "System",
        messages: [
          { role: "user", content: "Prompt user msg" },
          { role: "assistant", content: "Prompt assistant msg" },
        ],
      });

      const adapter = new PromptConfigAdapter(
        "prompt-id",
        promptService,
        "project-id",
      );

      await adapter.call(
        createAgentInput([{ role: "user", content: "New user input" }]),
      );

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      const messages = callArgs?.messages as Array<{
        role: string;
        content: string;
      }>;

      expect(messages).toEqual([
        { role: "system", content: "System" },
        { role: "user", content: "Prompt user msg" },
        { role: "assistant", content: "Prompt assistant msg" },
        { role: "user", content: "New user input" },
      ]);
    });

    it("passes temperature and maxTokens to generateText", async () => {
      const { generateText } = await import("ai");
      const mockGenerateText = vi.mocked(generateText);
      mockGenerateText.mockClear();

      const promptService = createMockPromptService({
        temperature: 0.9,
        maxTokens: 500,
      });

      const adapter = new PromptConfigAdapter(
        "prompt-id",
        promptService,
        "project-id",
      );

      await adapter.call(createAgentInput([]));

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.temperature).toBe(0.9);
      expect(callArgs?.maxOutputTokens).toBe(500);
    });
  });

  describe("when prompt not found", () => {
    it("throws an error", async () => {
      const promptService = {
        getPromptByIdOrHandle: vi.fn().mockResolvedValue(null),
      } as unknown as PromptService;

      const adapter = new PromptConfigAdapter(
        "nonexistent",
        promptService,
        "project-id",
      );

      await expect(adapter.call(createAgentInput([]))).rejects.toThrow(
        "Prompt nonexistent not found",
      );
    });
  });
});
