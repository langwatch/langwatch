import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { PromptService } from "../service";
import { Prompt, PromptCompilationError } from "../prompt";
import type { LangwatchApiClient } from "../../internal/api/client";

// Mock the client with proper Vitest mock methods
const mockClient = {
  GET: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
} as unknown as LangwatchApiClient & {
  GET: ReturnType<typeof vi.fn>;
  POST: ReturnType<typeof vi.fn>;
  PUT: ReturnType<typeof vi.fn>;
  DELETE: ReturnType<typeof vi.fn>;
};

// Mock the createLangWatchApiClient function
vi.mock("../../internal/api/client", () => ({
  createLangWatchApiClient: vi.fn(() => mockClient),
}));

describe("Prompt", () => {
  let promptService: PromptService;

  beforeAll(async () => {
    promptService = new PromptService({ client: mockClient });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and compile a prompt", async () => {
    // Mock the API response
    const mockPromptData = {
      id: "prompt_123",
      name: "Test Prompt",
      prompt: "Hello {{user_name}}, how is the {{topic}} today?",
      messages: [
        {
          role: "user",
          content: "Tell me about {{topic}}",
        },
      ],
      model: "gpt-4",
      version: 1,
      updatedAt: "2024-01-01T00:00:00Z",
    };

    mockClient.GET.mockResolvedValueOnce({
      data: mockPromptData,
      error: null,
    });

    const prompt = await promptService.get("prompt_123");

    expect(prompt).toBeDefined();

    expect(prompt?.id).toBe("prompt_123");
    expect(prompt?.name).toBe("Test Prompt");

    // Test template compilation
    const compiled = prompt?.compile({
      user_name: "Alice",
      topic: "weather",
    });

    expect(compiled?.prompt).toContain("Alice");
    expect(JSON.stringify(compiled?.messages)).toContain("weather");
  });

  it("should handle missing template variables gracefully", async () => {
    // Mock the API response
    const mockPromptData = {
      id: "prompt_123",
      name: "Test Prompt",
      prompt: "Hello {{user_name}}, how is the {{topic}} today?",
      messages: [
        {
          role: "user",
          content: "Tell me about {{topic}}",
        },
      ],
      model: "gpt-4",
      version: 1,
      updatedAt: "2024-01-01T00:00:00Z",
    };

    mockClient.GET.mockResolvedValueOnce({
      data: mockPromptData,
      error: null,
    });

    const prompt = await promptService.get("prompt_123");

    // Lenient compilation should not throw and should replace missing variables with empty strings
    const compiled = prompt?.compile({ user_name: "Alice", topic: "weather" });
    expect(compiled).toBeInstanceOf(Prompt);
    expect(compiled?.prompt).toBe("Hello Alice, how is the weather today?");
    expect(compiled?.messages[0]?.content).toBe("Tell me about weather");
  });

  it("should throw on strict compilation with missing variables", async () => {
    // Mock the API response
    const mockPromptData = {
      id: "prompt_123",
      name: "Test Prompt",
      prompt: "Hello {{user_name}}, how is the {{topic}} today?",
      messages: [
        {
          role: "user",
          content: "Tell me about {{topic}}",
        },
      ],
      model: "gpt-4",
      version: 1,
      updatedAt: "2024-01-01T00:00:00Z",
    };

    mockClient.GET.mockResolvedValueOnce({
      data: mockPromptData,
      error: null,
    });

    const prompt = await promptService.get("prompt_123");

    expect(() => {
      prompt?.compileStrict({});
    }).toThrow(PromptCompilationError);
  });

  it.todo("should create a prompt");
  it.todo("should update a prompt");
  it.todo("should delete a prompt");
  it.todo("should create a prompt version");
  it.todo("should get a prompt version");
  it.todo("should list prompt versions");
  it.todo("should delete a prompt version");
});
