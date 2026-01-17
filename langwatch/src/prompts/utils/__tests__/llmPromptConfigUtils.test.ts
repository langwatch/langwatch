/* eslint-disable @typescript-eslint/no-empty-function */
import { PromptScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { VersionedPrompt } from "~/server/prompt-config";
import {
  promptConfigFormValuesToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../llmPromptConfigUtils";

describe("safeOptimizationStudioNodeDataToPromptConfigFormInitialValues", () => {
  describe("when LLM value is an object", () => {
    it("preserves the LLM value", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: {
              model: "gpt-4",
              temperature: 0.7,
              max_tokens: 1000,
            },
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({
        model: "gpt-4",
        temperature: 0.7,
        max_tokens: 1000,
      });
    });
  });

  describe("when LLM value is a string (legacy format)", () => {
    it("migrates legacy format to object with model field", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: "openai/gpt-4-0125-preview",
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({
        model: "openai/gpt-4-0125-preview",
      });
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when LLM value is missing", () => {
    it("defaults LLM value to empty object", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({});
    });
  });

  describe("when handle is missing", () => {
    it("defaults handle to null", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.handle).toBeNull();
    });
  });

  describe("when scope is missing", () => {
    it("defaults scope to PROJECT", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.scope).toBe(PromptScope.PROJECT);
    });
  });

  describe("when prompt is missing", () => {
    it("defaults prompt to empty string", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.messages?.[0]?.content).toBe("");
    });
  });

  describe("when input identifier is empty string", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [{ identifier: "", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when input identifier is undefined", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [{ type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when multiple inputs have empty identifiers", () => {
    it("generates unique identifiers for each", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      expect(result.version?.configData?.inputs?.[1]?.identifier).toBe(
        "input_1",
      );
      expect(result.version?.configData?.inputs?.[2]?.identifier).toBe(
        "input_2",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when output identifier is empty string", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when output identifier is undefined", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when multiple outputs have empty identifiers", () => {
    it("generates unique identifiers for each", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
        ],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      expect(result.version?.configData?.outputs?.[1]?.identifier).toBe(
        "output_1",
      );
      consoleWarnSpy.mockRestore();
    });
  });
});

describe("versionedPromptToPromptConfigFormValues", () => {
  /**
   * Creates a mock VersionedPrompt for testing handle extraction
   */
  const createMockPrompt = (handle: string | null): VersionedPrompt => ({
    id: "prompt-1",
    name: "test-prompt",
    handle: handle,
    scope: PromptScope.PROJECT,
    version: 1,
    versionId: "version-1",
    versionCreatedAt: new Date(),
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 1000,
    prompt: "You are a helpful assistant.",
    projectId: "test-project",
    organizationId: "org-1",
    authorId: null,
    messages: [],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    updatedAt: new Date(),
    createdAt: new Date(),
  });

  describe("when prompt handle has no prefix", () => {
    it("keeps simple handle unchanged", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("gato"),
      );
      expect(result.handle).toBe("gato");
    });

    it("keeps folder handle unchanged", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("folder/gato"),
      );
      expect(result.handle).toBe("folder/gato");
    });
  });

  describe("when prompt handle has project_ prefix", () => {
    it("strips project prefix from simple handle", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("project_CfNq0pGCaUnwalAWkERgz/gato"),
      );
      expect(result.handle).toBe("gato");
    });

    it("strips project prefix but keeps folder structure", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("project_CfNq0pGCaUnwalAWkERgz/folder/gato"),
      );
      expect(result.handle).toBe("folder/gato");
    });
  });

  describe("when prompt handle has organization_ prefix", () => {
    it("strips organization prefix from simple handle", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("organization_ABC123/gato"),
      );
      expect(result.handle).toBe("gato");
    });
  });

  describe("when prompt handle has 21-char nanoid prefix", () => {
    it("strips nanoid prefix from simple handle", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("iuc4aYIoL5YcI7imutYvl/gato"),
      );
      expect(result.handle).toBe("gato");
    });

    it("strips nanoid prefix but keeps folder structure", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt("KAXYxPR8MUgTcP8CF193y/folder/gato"),
      );
      expect(result.handle).toBe("folder/gato");
    });
  });

  describe("when prompt handle is null", () => {
    it("keeps handle as null", () => {
      const result = versionedPromptToPromptConfigFormValues(
        createMockPrompt(null),
      );
      expect(result.handle).toBeNull();
    });
  });
});

describe("versionedPromptToPromptConfigFormValuesWithSystemMessage", () => {
  /**
   * Creates a mock VersionedPrompt for testing
   */
  const createMockVersionedPrompt = (
    overrides: Partial<VersionedPrompt> = {},
  ): VersionedPrompt => ({
    id: "prompt-1",
    name: "test-prompt",
    handle: "test-prompt",
    scope: PromptScope.PROJECT,
    version: 1,
    versionId: "version-1",
    versionCreatedAt: new Date(),
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 1000,
    prompt: "You are a helpful assistant.", // System message stored here
    projectId: "test-project",
    organizationId: "org-1",
    authorId: null,
    messages: [{ role: "user", content: "Hello!" }], // Non-system messages
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

  it("includes system message in messages array", () => {
    const prompt = createMockVersionedPrompt({
      prompt: "You are a cat.",
      messages: [{ role: "user", content: "Say meow" }],
    });

    const result =
      versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);

    // System message should be first in the array
    expect(result.version.configData.messages[0]).toEqual({
      role: "system",
      content: "You are a cat.",
    });
    // User message should follow
    expect(result.version.configData.messages[1]).toEqual({
      role: "user",
      content: "Say meow",
    });
  });

  it("does NOT include system message when using versionedPromptToPromptConfigFormValues (without system message)", () => {
    const prompt = createMockVersionedPrompt({
      prompt: "You are a cat.",
      messages: [{ role: "user", content: "Say meow" }],
    });

    const result = versionedPromptToPromptConfigFormValues(prompt);

    // Should NOT have the system message
    expect(result.version.configData.messages.length).toBe(1);
    expect(result.version.configData.messages[0]).toEqual({
      role: "user",
      content: "Say meow",
    });
  });

  describe("optimization studio form reset regression test", () => {
    /**
     * BUG: When saving a prompt in the optimization studio, using the wrong function
     * (versionedPromptToPromptConfigFormValues instead of WithSystemMessage) caused
     * the system prompt content to disappear from the workflow DSL.
     *
     * This test ensures the correct function preserves the system message through
     * the round-trip: VersionedPrompt -> FormValues -> NodeData
     */
    it("preserves system message through form reset and node data conversion", () => {
      const savedPrompt = createMockVersionedPrompt({
        prompt: "You are a helpful cat assistant.",
        messages: [],
      });

      // Simulate what happens in PromptSourceHeader.onSuccess after saving:
      // 1. Convert saved prompt to form values (MUST use WithSystemMessage)
      const formValues =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(savedPrompt);

      // Verify form values have the system message
      expect(formValues.version.configData.messages).toHaveLength(1);
      expect(formValues.version.configData.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful cat assistant.",
      });

      // 2. Simulate what syncNodeDataWithFormValues does - convert form to node data
      const nodeData =
        promptConfigFormValuesToOptimizationStudioNodeData(formValues);

      // Verify node data has the instructions (system prompt)
      const instructionsParam = nodeData.parameters?.find(
        (p) => p.identifier === "instructions",
      );
      expect(instructionsParam?.value).toBe("You are a helpful cat assistant.");

      // Verify messages param does NOT have the system message (it's stored separately in instructions)
      const messagesParam = nodeData.parameters?.find(
        (p) => p.identifier === "messages",
      );
      expect(messagesParam?.value).toEqual([]);
    });

    it("FAILS to preserve system message when using wrong function (demonstrating the bug)", () => {
      const savedPrompt = createMockVersionedPrompt({
        prompt: "You are a helpful cat assistant.",
        messages: [],
      });

      // BUG: Using versionedPromptToPromptConfigFormValues (WITHOUT system message)
      const formValuesWRONG =
        versionedPromptToPromptConfigFormValues(savedPrompt);

      // Form values are MISSING the system message!
      expect(formValuesWRONG.version.configData.messages).toHaveLength(0);

      // When converted to node data, instructions will be empty
      const nodeDataWRONG =
        promptConfigFormValuesToOptimizationStudioNodeData(formValuesWRONG);
      const instructionsParam = nodeDataWRONG.parameters?.find(
        (p) => p.identifier === "instructions",
      );

      // BUG: The system prompt is LOST
      expect(instructionsParam?.value).toBe("");
    });
  });
});
