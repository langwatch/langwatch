import { describe, it, expect } from "vitest";
import { computeInitialFormValuesForPrompt } from "../computeInitialFormValuesForPrompt";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

describe("computeInitialFormValuesForPrompt", () => {
  const mockVersionedPrompt: VersionedPrompt = {
    id: "prompt-123",
    handle: "test-prompt",
    prompt: "You are a helpful assistant.",
    scope: "PROJECT",
    version: 1,
    versionId: "version-456",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    versionCreatedAt: new Date("2024-01-01"),
    inputs: [
      { identifier: "query", type: "str" },
      { identifier: "context", type: "str" },
    ],
    outputs: [{ identifier: "output", type: "str" }],
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ],
    llm: {
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 1000,
    },
  };

  describe("with prompt parameter", () => {
    it("should convert versioned prompt to form values without system message by default", () => {
      const result = computeInitialFormValuesForPrompt({
        prompt: mockVersionedPrompt,
      });

      expect(result).toMatchObject({
        configId: "prompt-123",
        handle: "test-prompt",
        scope: "PROJECT",
        version: {
          versionId: "version-456",
          versionNumber: 1,
          configData: {
            prompt: "You are a helpful assistant.",
            llm: {
              model: "gpt-4",
              temperature: 0.7,
              maxTokens: 1000,
            },
            inputs: [
              { identifier: "query", type: "str" },
              { identifier: "context", type: "str" },
            ],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there!" },
            ],
          },
        },
      });
    });

    it("should convert versioned prompt with system message when useSystemMessage is true", () => {
      const result = computeInitialFormValuesForPrompt({
        prompt: mockVersionedPrompt,
        useSystemMessage: true,
      });

      expect(result.version.configData.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]);
    });

    it("should handle prompt with empty messages", () => {
      const promptWithEmptyMessages: VersionedPrompt = {
        ...mockVersionedPrompt,
        messages: [],
      };

      const result = computeInitialFormValuesForPrompt({
        prompt: promptWithEmptyMessages,
        useSystemMessage: true,
      });

      expect(result.version.configData.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
      ]);
    });

    it("should filter out existing system messages from prompt messages", () => {
      const promptWithSystemMessage: VersionedPrompt = {
        ...mockVersionedPrompt,
        messages: [
          { role: "system", content: "Old system message" },
          { role: "user", content: "Hello" },
        ],
      };

      const result = computeInitialFormValuesForPrompt({
        prompt: promptWithSystemMessage,
        useSystemMessage: false,
      });

      expect(result.version.configData.messages).toEqual([
        { role: "user", content: "Hello" },
      ]);
    });

    it("should ignore defaultModel when prompt is provided", () => {
      const result = computeInitialFormValuesForPrompt({
        prompt: mockVersionedPrompt,
        defaultModel: "gpt-3.5-turbo",
      });

      expect(result.version.configData.llm.model).toBe("gpt-4");
    });
  });

  describe("with defaultModel parameter (no prompt)", () => {
    it("should create default form values with specified model", () => {
      const result = computeInitialFormValuesForPrompt({
        defaultModel: "gpt-3.5-turbo",
      });

      expect(result.version.configData.llm.model).toBe("gpt-3.5-turbo");
      expect(result.handle).toBeNull();
      expect(result.configId).toBeUndefined();
    });

    it("should handle empty string defaultModel", () => {
      const result = computeInitialFormValuesForPrompt({
        defaultModel: "",
      });

      // Should fall back to defaults
      expect(result.version.configData.llm).toBeDefined();
      expect(result.handle).toBeNull();
    });
  });

  describe("with no parameters", () => {
    it("should return default form values", () => {
      const result = computeInitialFormValuesForPrompt({});

      expect(result).toMatchObject({
        handle: null,
        scope: "PROJECT",
        version: {
          configData: {
            inputs: [],
            outputs: expect.arrayContaining([
              expect.objectContaining({ identifier: "output", type: "str" }),
            ]),
          },
        },
      });
      expect(result.configId).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle null prompt", () => {
      const result = computeInitialFormValuesForPrompt({
        prompt: null,
      });

      expect(result.handle).toBeNull();
      expect(result.configId).toBeUndefined();
    });

    it("should handle undefined prompt", () => {
      const result = computeInitialFormValuesForPrompt({
        prompt: undefined,
      });

      expect(result.handle).toBeNull();
      expect(result.configId).toBeUndefined();
    });

    it("should handle prompt with optional fields undefined", () => {
      const minimalPrompt: VersionedPrompt = {
        id: "prompt-123",
        handle: "minimal",
        prompt: "Test",
        scope: "PROJECT",
        version: 1,
        versionId: "v1",
        createdAt: new Date(),
        updatedAt: new Date(),
        versionCreatedAt: new Date(),
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        messages: [],
        llm: {
          model: "gpt-4",
        },
      };

      const result = computeInitialFormValuesForPrompt({
        prompt: minimalPrompt,
      });

      expect(result.configId).toBe("prompt-123");
      expect(result.version.configData.llm.temperature).toBeUndefined();
      expect(result.version.configData.llm.maxTokens).toBeUndefined();
    });

    it("should preserve all LLM config fields", () => {
      const promptWithFullLlmConfig: VersionedPrompt = {
        ...mockVersionedPrompt,
        llm: {
          model: "gpt-4-turbo",
          temperature: 0.8,
          maxTokens: 2000,
          topP: 0.9,
          presencePenalty: 0.5,
          frequencyPenalty: 0.3,
        },
      };

      const result = computeInitialFormValuesForPrompt({
        prompt: promptWithFullLlmConfig,
      });

      expect(result.version.configData.llm).toMatchObject({
        model: "gpt-4-turbo",
        temperature: 0.8,
        maxTokens: 2000,
        topP: 0.9,
        presencePenalty: 0.5,
        frequencyPenalty: 0.3,
      });
    });

    it("should handle ORGANIZATION scope", () => {
      const orgPrompt: VersionedPrompt = {
        ...mockVersionedPrompt,
        scope: "ORGANIZATION",
      };

      const result = computeInitialFormValuesForPrompt({
        prompt: orgPrompt,
      });

      expect(result.scope).toBe("ORGANIZATION");
    });
  });
});