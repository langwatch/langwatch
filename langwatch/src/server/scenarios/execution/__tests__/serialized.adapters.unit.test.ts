/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData, LiteLLMParams, PromptConfigData } from "../types";
import {
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "../serialized.adapters";

// Mock dependencies
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../model.factory", () => ({
  createModelFromParams: vi.fn(() => ({ modelId: "test-model" })),
}));

import { generateText } from "ai";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const mockGenerateText = vi.mocked(generateText);
const mockSsrfSafeFetch = vi.mocked(ssrfSafeFetch);

describe("SerializedPromptConfigAdapter", () => {
  const defaultConfig: PromptConfigData = {
    type: "prompt",
    promptId: "prompt_123",
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello" }],
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
    judgmentRequest: false,
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
    const adapter = new SerializedPromptConfigAdapter(
      defaultConfig,
      defaultLitellmParams,
      "http://localhost:8080",
    );
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedPromptConfigAdapter(
      defaultConfig,
      defaultLitellmParams,
      "http://localhost:8080",
    );
    expect(adapter.name).toBe("SerializedPromptConfigAdapter");
  });

  it("builds messages with system prompt first", async () => {
    const adapter = new SerializedPromptConfigAdapter(
      defaultConfig,
      defaultLitellmParams,
      "http://localhost:8080",
    );

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
    const adapter = new SerializedPromptConfigAdapter(
      defaultConfig,
      defaultLitellmParams,
      "http://localhost:8080",
    );

    await adapter.call(defaultInput);

    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messages = callArgs.messages as Array<{ role: string; content: string }>;

    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
  });

  it("passes temperature to generateText", async () => {
    const adapter = new SerializedPromptConfigAdapter(
      { ...defaultConfig, temperature: 0.5 },
      defaultLitellmParams,
      "http://localhost:8080",
    );

    await adapter.call(defaultInput);

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.5,
      }),
    );
  });

  it("passes maxTokens to generateText", async () => {
    const adapter = new SerializedPromptConfigAdapter(
      { ...defaultConfig, maxTokens: 500 },
      defaultLitellmParams,
      "http://localhost:8080",
    );

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

    const adapter = new SerializedPromptConfigAdapter(
      defaultConfig,
      defaultLitellmParams,
      "http://localhost:8080",
    );

    const result = await adapter.call(defaultInput);

    expect(result).toBe("Generated response");
  });
});

describe("SerializedHttpAgentAdapter", () => {
  const defaultConfig: HttpAgentData = {
    type: "http",
    agentId: "agent_123",
    url: "https://api.example.com/chat",
    method: "POST",
    headers: [],
    outputPath: "$.response",
  };

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,
    judgmentRequest: false,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "API response" }),
      text: vi.fn().mockResolvedValue("API response"),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
  });

  it("has AGENT role", () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);
    expect(adapter.name).toBe("SerializedHttpAgentAdapter");
  });

  it("makes HTTP request with correct URL and method", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://api.example.com/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("includes Content-Type header", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("includes custom headers", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      headers: [
        { key: "X-Custom-Header", value: "custom-value" },
        { key: "X-Another", value: "another-value" },
      ],
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Custom-Header": "custom-value",
          "X-Another": "another-value",
        }),
      }),
    );
  });

  it("applies bearer authentication", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      auth: { type: "bearer", token: "secret-token" },
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("applies api_key authentication", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      auth: { type: "api_key", header: "X-API-Key", value: "my-key" },
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "my-key",
        }),
      }),
    );
  });

  it("extracts response using JSONPath", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    const result = await adapter.call(defaultInput);

    expect(result).toBe("API response");
  });

  it("returns full response when outputPath not set", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      outputPath: undefined,
    };
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ data: "value" }),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter(config);
    const result = await adapter.call(defaultInput);

    expect(result).toBe('{"data":"value"}');
  });

  it("throws on HTTP error", async () => {
    mockSsrfSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await expect(adapter.call(defaultInput)).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    );
  });

  it("does not send body for GET requests", async () => {
    const config: HttpAgentData = { ...defaultConfig, method: "GET" };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: undefined,
      }),
    );
  });

  describe("body templating", () => {
    it("replaces {{messages}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"messages": {{messages}}}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("replaces {{threadId}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"thread": "{{threadId}}"}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.thread).toBe("thread_123");
    });

    it("replaces {{input}} placeholder with last user message", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"input": "{{input}}"}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.input).toBe("Hello");
    });
  });
});
