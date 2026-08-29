/**
 * @vitest-environment node
 */

import { createLogger } from "@langwatch/observability";
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiteLLMParams, PromptConfigData } from "@langwatch/scenario-contract";
import { SerializedPromptConfigAdapter } from "@langwatch/scenario-server";

// Mock dependencies
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@langwatch/scenario-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/scenario-server")>();
  return {
    ...actual,
    createModelFromParams: vi.fn(() => ({ modelId: "test-model" })),
  };
});

import { generateText } from "ai";

const mockGenerateText = vi.mocked(generateText);

describe("SerializedPromptConfigAdapter", () => {
  const defaultConfig: PromptConfigData = {
    type: "prompt",
    promptId: "prompt_123",
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello" }],
    inputs: [],
    model: "openai/gpt-4",
    temperature: 0.7,
    maxTokens: 1000,
  };

  const defaultLitellmParams: LiteLLMParams = {
    api_key: "test-key",
    model: "openai/gpt-4",
  };

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "How are you?" }],
    newMessages: [{ role: "user", content: "How are you?" }],
    requestedRole: AgentRole.AGENT,

    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "I am doing well!",
    } as Awaited<ReturnType<typeof generateText>>);
  });

  it("has AGENT role", () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: defaultConfig,
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: defaultConfig,
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });
    expect(adapter.name).toBe("SerializedPromptConfigAdapter");
  });

  it("builds messages with system prompt first", async () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: defaultConfig,
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });

    await adapter.call(defaultInput);

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: "system", content: "You are a helpful assistant." },
        ]),
      }),
    );
  });

  it("includes prompt messages before conversation history", async () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: defaultConfig,
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });

    await adapter.call(defaultInput);

    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messages = callArgs.messages as Array<{
      role: string;
      content: string;
    }>;

    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
  });

  it("passes temperature to generateText", async () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: { ...defaultConfig, temperature: 0.5 },
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });

    await adapter.call(defaultInput);

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.5,
      }),
    );
  });

  it("passes maxTokens to generateText", async () => {
    const adapter = new SerializedPromptConfigAdapter({
      config: { ...defaultConfig, maxTokens: 500 },
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });

    await adapter.call(defaultInput);

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 500,
      }),
    );
  });

  it("returns generated text", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Generated response",
    } as Awaited<ReturnType<typeof generateText>>);

    const adapter = new SerializedPromptConfigAdapter({
      config: defaultConfig,
      litellmParams: defaultLitellmParams,
      nlpServiceUrl: "http://localhost:8080",
    });

    const result = await adapter.call(defaultInput);

    expect(result).toBe("Generated response");
  });

  describe("template interpolation", () => {
    it("replaces {{input}} in system prompt with last user message", async () => {
      const config: PromptConfigData = {
        ...defaultConfig,
        systemPrompt: "You are helping with: {{input}}",
        messages: [],
      };
      const adapter = new SerializedPromptConfigAdapter({
        config: config,
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
      });

      await adapter.call(defaultInput);

      const callArgs = mockGenerateText.mock.calls[0]![0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: string;
      }>;

      expect(messages[0]).toEqual({
        role: "system",
        content: "You are helping with: How are you?",
      });
      // Input messages still appended for conversation context
      expect(messages[1]).toEqual({ role: "user", content: "How are you?" });
    });

    it("replaces {{input}} in template messages", async () => {
      const config: PromptConfigData = {
        ...defaultConfig,
        systemPrompt: "You are a helpful assistant.",
        messages: [{ role: "user", content: "User asked: {{input}}" }],
      };
      const adapter = new SerializedPromptConfigAdapter({
        config: config,
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
      });

      await adapter.call(defaultInput);

      const callArgs = mockGenerateText.mock.calls[0]![0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: string;
      }>;

      expect(messages[1]).toEqual({
        role: "user",
        content: "User asked: How are you?",
      });
    });

    describe("given a template that mentions messages only in prose", () => {
      /** @scenario "The word 'messages' in prose does not suppress the conversation" */
      it("still sends the conversation to the model", async () => {
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt: "Summarise the customer's messages politely.",
          messages: [],
        };
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
        });

        await adapter.call(defaultInput);

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const messages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        // System + the conversation. Before the fix the bare word "messages"
        // matched the history-suppression check and the model was told to
        // summarise a conversation it was never shown.
        expect(messages).toHaveLength(2);
        expect(messages[1]).toMatchObject({
          role: "user",
          content: "How are you?",
        });
      });
    });

    describe("given a prompt that declares its own inputs", () => {
      /** @scenario "A declared input is bound by name to a scenario source" */
      it("binds them in the rendered system prompt", async () => {
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt: "question: {{question}}\nthread: {{thread_id}}",
          messages: [],
          inputs: [
            { identifier: "question", type: "str" },
            { identifier: "thread_id", type: "str" },
          ],
        };
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
        });

        await adapter.call({ ...defaultInput, threadId: "thread_abc" });

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const messages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        expect(messages[0]!.content).toBe("question: How are you?\nthread: thread_abc");
      });

      /** @scenario "An input nothing can be bound to renders as a visible placeholder" */
      it("renders a placeholder for one it cannot bind", async () => {
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt: "tier: {{customer_tier}}",
          messages: [],
          // Two inputs on purpose: a lone declared input falls back to the
          // scenario message (computeBestMatchMappings), which is right for a
          // single-input agent and would hide the unbound case here.
          inputs: [
            { identifier: "question", type: "str" },
            { identifier: "customer_tier", type: "str" },
          ],
        };
        const logger = createLogger("scenario-prompt-adapter-test");
        vi.spyOn(logger, "warn").mockImplementation(() => void 0);
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
          logger,
        });

        await adapter.call(defaultInput);

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const messages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        expect(messages[0]!.content).toBe("tier: [unbound input: customer_tier]");
      });
    });

    it("replaces {{messages}} in system prompt and does not append input.messages", async () => {
      const config: PromptConfigData = {
        ...defaultConfig,
        systemPrompt: "Conversation so far: {{messages}}",
        messages: [],
      };
      const adapter = new SerializedPromptConfigAdapter({
        config: config,
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
      });

      await adapter.call(defaultInput);

      const callArgs = mockGenerateText.mock.calls[0]![0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: string;
      }>;

      // Only system message - input.messages not appended because template handles it
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toContain("How are you?");
      expect(messages[0]!.role).toBe("system");
    });

    it("does not append input.messages when {{messages}} is in template message", async () => {
      const config: PromptConfigData = {
        ...defaultConfig,
        systemPrompt: "You are helpful.",
        messages: [{ role: "user", content: "History: {{messages}}" }],
      };
      const adapter = new SerializedPromptConfigAdapter({
        config: config,
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
      });

      await adapter.call(defaultInput);

      const callArgs = mockGenerateText.mock.calls[0]![0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: string;
      }>;

      // System + template message only - input.messages not appended
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe("system");
      expect(messages[1]!.content).toContain("How are you?");
    });

    describe("given a template that reads the conversation in structured form", () => {
      /** @scenario "A template that reads the conversation in structured form places it too" */
      it("does not send the conversation a second time", async () => {
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt: "Conversation so far: {{messagesJson}}",
          messages: [],
        };
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
        });

        await adapter.call(defaultInput);

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const messages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        // Only the system message. The template already carries the turn, so an
        // appended input.messages would show the model the same turn twice —
        // and every prior turn twice on turn three.
        expect(messages).toHaveLength(1);
        expect(messages[0]!.role).toBe("system");
        expect(messages[0]!.content).toContain("How are you?");
      });
    });

    it("appends input.messages when no {{messages}} in template", async () => {
      const adapter = new SerializedPromptConfigAdapter({
        config: defaultConfig,
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
      });

      await adapter.call(defaultInput);

      const callArgs = mockGenerateText.mock.calls[0]![0];
      const messages = callArgs.messages as Array<{
        role: string;
        content: string;
      }>;

      // System + template message + input message
      expect(messages).toHaveLength(3);
      expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
    });

    describe("when system prompt contains Liquid conditions", () => {
      it("renders if/else based on input content", async () => {
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt:
            "{% if input contains 'refund' %}You handle refunds.{% else %}You are a general assistant.{% endif %}",
          messages: [],
        };
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
        });

        const input: AgentInput = {
          ...defaultInput,
          messages: [{ role: "user", content: "I need a refund" }],
          newMessages: [{ role: "user", content: "I need a refund" }],
        };

        await adapter.call(input);

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const messages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        expect(messages[0]).toEqual({
          role: "system",
          content: "You handle refunds.",
        });
      });
    });

    describe("when message template contains Liquid loops", () => {
      it("renders for loops in message content", async () => {
        // The adapter passes `messages` as a JSON string and `input` as a string.
        // To test Liquid loop rendering, we use a split filter to create an array
        // from the input string, which demonstrates the Liquid engine processes loops.
        const config: PromptConfigData = {
          ...defaultConfig,
          systemPrompt: "You are a helpful assistant.",
          messages: [
            {
              role: "user",
              content:
                '{% assign items = "Hello,How are you?" | split: "," %}Summary: {% for msg in items %}[{{ msg }}]{% endfor %}',
            },
          ],
        };
        const adapter = new SerializedPromptConfigAdapter({
          config: config,
          litellmParams: defaultLitellmParams,
          nlpServiceUrl: "http://localhost:8080",
        });

        await adapter.call(defaultInput);

        const callArgs = mockGenerateText.mock.calls[0]![0];
        const promptMessages = callArgs.messages as Array<{
          role: string;
          content: string;
        }>;

        const userMessage = promptMessages[1];
        expect(userMessage?.role).toBe("user");
        expect(userMessage?.content).toBe("Summary: [Hello][How are you?]");
        // Verify Liquid tags are fully rendered (no raw template syntax remains)
        expect(userMessage?.content).not.toContain("{%");
        expect(userMessage?.content).not.toContain("%}");
      });
    });
  });

  describe("given a run that resolved parameter values", () => {
    /** @scenario "A prompt target reads params in its prompt template" */
    it("sends the model a prompt that reads the resolved value", async () => {
      const adapter = new SerializedPromptConfigAdapter({
        config: {
          ...defaultConfig,
          systemPrompt:
            "You serve a {{ params.account_tier }} customer in {{ params.region }}.",
          messages: [{ role: "user", content: "Tier: {{ params.account_tier }}" }],
        },
        litellmParams: defaultLitellmParams,
        nlpServiceUrl: "http://localhost:8080",
        parameters: { account_tier: "platinum", region: "eu-central" },
      });

      await adapter.call(defaultInput);

      const promptMessages = mockGenerateText.mock.calls[0]![0].messages as Array<{
        role: string;
        content: string;
      }>;

      expect(promptMessages[0]?.content).toBe(
        "You serve a platinum customer in eu-central.",
      );
      expect(promptMessages[1]?.content).toBe("Tier: platinum");
    });
  });
});
