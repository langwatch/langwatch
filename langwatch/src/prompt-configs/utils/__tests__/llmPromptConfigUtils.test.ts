import { describe, it, expect } from "vitest";
import {
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
  formValuesToTriggerSaveVersionParams,
} from "../llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

describe("llmPromptConfigUtils", () => {
  const mockVersionedPrompt: VersionedPrompt = {
    id: "prompt-abc",
    handle: "my-prompt",
    prompt: "You are a helpful AI assistant.",
    scope: "PROJECT",
    version: 2,
    versionId: "version-xyz",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    versionCreatedAt: new Date("2024-01-02"),
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    messages: [
      { role: "system", content: "System instructions" },
      { role: "user", content: "User query" },
      { role: "assistant", content: "Assistant response" },
    ],
    llm: {
      model: "gpt-4",
      temperature: 0.5,
      maxTokens: 500,
    },
    promptingTechnique: "few_shot",
    demonstrations: {
      datasetId: "dataset-123",
    },
  };

  describe("versionedPromptToPromptConfigFormValues", () => {
    it("should convert versioned prompt to form values without system message", () => {
      const result = versionedPromptToPromptConfigFormValues(mockVersionedPrompt);

      expect(result).toMatchObject({
        configId: "prompt-abc",
        handle: "my-prompt",
        scope: "PROJECT",
        version: {
          versionId: "version-xyz",
          versionNumber: 2,
          configData: {
            prompt: "You are a helpful AI assistant.",
            llm: {
              model: "gpt-4",
              temperature: 0.5,
              maxTokens: 500,
            },
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            promptingTechnique: "few_shot",
            demonstrations: {
              datasetId: "dataset-123",
            },
          },
        },
      });
    });

    it("should filter out system messages", () => {
      const result = versionedPromptToPromptConfigFormValues(mockVersionedPrompt);

      expect(result.version.configData.messages).toEqual([
        { role: "user", content: "User query" },
        { role: "assistant", content: "Assistant response" },
      ]);
    });

    it("should handle prompt with no system messages", () => {
      const promptWithoutSystem: VersionedPrompt = {
        ...mockVersionedPrompt,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
      };

      const result = versionedPromptToPromptConfigFormValues(promptWithoutSystem);

      expect(result.version.configData.messages).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);
    });

    it("should handle empty messages array", () => {
      const promptWithEmptyMessages: VersionedPrompt = {
        ...mockVersionedPrompt,
        messages: [],
      };

      const result = versionedPromptToPromptConfigFormValues(promptWithEmptyMessages);

      expect(result.version.configData.messages).toEqual([]);
    });
  });

  describe("versionedPromptToPromptConfigFormValuesWithSystemMessage", () => {
    it("should add system message at the beginning", () => {
      const result = versionedPromptToPromptConfigFormValuesWithSystemMessage(mockVersionedPrompt);

      expect(result.version.configData.messages?.[0]).toEqual({
        role: "system",
        content: "You are a helpful AI assistant.",
      });
    });

    it("should prepend system message to filtered messages", () => {
      const result = versionedPromptToPromptConfigFormValuesWithSystemMessage(mockVersionedPrompt);

      expect(result.version.configData.messages).toEqual([
        { role: "system", content: "You are a helpful AI assistant." },
        { role: "user", content: "User query" },
        { role: "assistant", content: "Assistant response" },
      ]);
    });

    it("should handle prompt with empty prompt field", () => {
      const promptWithEmptyPrompt: VersionedPrompt = {
        ...mockVersionedPrompt,
        prompt: "",
      };

      const result = versionedPromptToPromptConfigFormValuesWithSystemMessage(promptWithEmptyPrompt);

      expect(result.version.configData.messages?.[0]).toEqual({
        role: "system",
        content: "",
      });
    });

    it("should not duplicate system messages", () => {
      const result = versionedPromptToPromptConfigFormValuesWithSystemMessage(mockVersionedPrompt);

      const systemMessages = result.version.configData.messages?.filter(
        (msg) => msg.role === "system"
      );
      expect(systemMessages).toHaveLength(1);
    });

    it("should preserve all other fields from base conversion", () => {
      const result = versionedPromptToPromptConfigFormValuesWithSystemMessage(mockVersionedPrompt);

      expect(result.configId).toBe("prompt-abc");
      expect(result.handle).toBe("my-prompt");
      expect(result.scope).toBe("PROJECT");
      expect(result.version.versionNumber).toBe(2);
      expect(result.version.configData.llm.model).toBe("gpt-4");
    });
  });

  describe("formValuesToTriggerSaveVersionParams", () => {
    const mockFormValues: PromptConfigFormValues = {
      configId: "config-123",
      handle: "test-handle",
      scope: "PROJECT",
      version: {
        versionId: "v1",
        versionNumber: 1,
        configData: {
          prompt: "System prompt from field",
          messages: [
            { role: "system", content: "System in messages" },
            { role: "user", content: "User message" },
          ],
          llm: {
            model: "gpt-3.5-turbo",
            temperature: 0.7,
          },
          inputs: [{ identifier: "query", type: "str" }],
          outputs: [{ identifier: "result", type: "str" }],
          promptingTechnique: "cot",
        },
      },
    };

    it("should extract system prompt from prompt field", () => {
      const result = formValuesToTriggerSaveVersionParams(mockFormValues);

      expect(result.prompt).toBe("System prompt from field");
    });

    it("should fall back to system message if prompt field is empty", () => {
      const formValuesNoPrompt: PromptConfigFormValues = {
        ...mockFormValues,
        version: {
          ...mockFormValues.version,
          configData: {
            ...mockFormValues.version.configData,
            prompt: undefined,
          },
        },
      };

      const result = formValuesToTriggerSaveVersionParams(formValuesNoPrompt);

      expect(result.prompt).toBe("System in messages");
    });

    it("should filter out system messages from messages array", () => {
      const result = formValuesToTriggerSaveVersionParams(mockFormValues);

      expect(result.messages).toEqual([
        { role: "user", content: "User message" },
      ]);
    });

    it("should preserve all configData fields", () => {
      const result = formValuesToTriggerSaveVersionParams(mockFormValues);

      expect(result).toMatchObject({
        handle: "test-handle",
        scope: "PROJECT",
        llm: {
          model: "gpt-3.5-turbo",
          temperature: 0.7,
        },
        inputs: [{ identifier: "query", type: "str" }],
        outputs: [{ identifier: "result", type: "str" }],
        promptingTechnique: "cot",
      });
    });

    it("should handle empty messages array", () => {
      const formValuesEmptyMessages: PromptConfigFormValues = {
        ...mockFormValues,
        version: {
          ...mockFormValues.version,
          configData: {
            ...mockFormValues.version.configData,
            messages: [],
          },
        },
      };

      const result = formValuesToTriggerSaveVersionParams(formValuesEmptyMessages);

      expect(result.messages).toEqual([]);
    });

    it("should handle undefined messages", () => {
      const formValuesUndefinedMessages: PromptConfigFormValues = {
        ...mockFormValues,
        version: {
          ...mockFormValues.version,
          configData: {
            ...mockFormValues.version.configData,
            messages: undefined,
          },
        },
      };

      const result = formValuesToTriggerSaveVersionParams(formValuesUndefinedMessages);

      expect(result.messages).toBeUndefined();
    });

    it("should handle multiple system messages by filtering all", () => {
      const formValuesMultipleSystem: PromptConfigFormValues = {
        ...mockFormValues,
        version: {
          ...mockFormValues.version,
          configData: {
            ...mockFormValues.version.configData,
            messages: [
              { role: "system", content: "First system" },
              { role: "user", content: "User" },
              { role: "system", content: "Second system" },
              { role: "assistant", content: "Assistant" },
            ],
          },
        },
      };

      const result = formValuesToTriggerSaveVersionParams(formValuesMultipleSystem);

      expect(result.messages).toEqual([
        { role: "user", content: "User" },
        { role: "assistant", content: "Assistant" },
      ]);
    });

    it("should preserve optional LLM parameters", () => {
      const formValuesFullLlm: PromptConfigFormValues = {
        ...mockFormValues,
        version: {
          ...mockFormValues.version,
          configData: {
            ...mockFormValues.version.configData,
            llm: {
              model: "gpt-4",
              temperature: 0.9,
              maxTokens: 1500,
              topP: 0.95,
              presencePenalty: 0.6,
              frequencyPenalty: 0.4,
            },
          },
        },
      };

      const result = formValuesToTriggerSaveVersionParams(formValuesFullLlm);

      expect(result.llm).toMatchObject({
        model: "gpt-4",
        temperature: 0.9,
        maxTokens: 1500,
        topP: 0.95,
        presencePenalty: 0.6,
        frequencyPenalty: 0.4,
      });
    });
  });
});