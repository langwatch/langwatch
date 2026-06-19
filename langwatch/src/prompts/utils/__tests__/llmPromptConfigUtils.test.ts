/* eslint-disable @typescript-eslint/no-empty-function */
import { PromptScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { VersionedPrompt } from "~/server/prompt-config";
import {
  formValuesToTriggerSaveVersionParams,
  nodeDataToLocalPromptConfig,
  promptConfigFormValuesToOptimizationStudioNodeData,
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "../llmPromptConfigUtils";
import { buildDefaultFormValues } from "../buildDefaultFormValues";
import { formSchema } from "~/prompts/schemas/form-schema";

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
    maxTokens: 4096,
    prompt: "You are a helpful assistant.",
    projectId: "test-project",
    organizationId: "org-1",
    authorId: null,
    messages: [],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    updatedAt: new Date(),
    createdAt: new Date(),
    tags: [],
    parameters: {},
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

  describe("when prompt has reasoning set", () => {
    /** @scenario "versionedPromptToPromptConfigFormValues maps reasoning correctly" */
    it("maps reasoning 'high' onto form values llm.reasoning", () => {
      const prompt = createMockPrompt("test-prompt");
      prompt.reasoning = "high";

      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.configData.llm.reasoning).toBe("high");
    });
  });

  describe("when prompt has no reasoning", () => {
    /** @scenario "versionedPromptToPromptConfigFormValues handles missing reasoning" */
    it("leaves form values llm.reasoning undefined", () => {
      const prompt = createMockPrompt("test-prompt");
      // reasoning intentionally not set

      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.configData.llm.reasoning).toBeUndefined();
    });
  });

  describe("when prompt has runtime parameters", () => {
    it("maps runtime parameters onto form values", () => {
      /**
       * @scenario Prompt form values preserve runtime parameters during API mapping
       */
      const prompt = createMockPrompt("test-prompt");
      prompt.parameters = { mapped: true };

      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.parameters).toEqual({ mapped: true });
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
    maxTokens: 4096,
    prompt: "You are a helpful assistant.", // System message stored here
    projectId: "test-project",
    organizationId: "org-1",
    authorId: null,
    messages: [{ role: "user", content: "Hello!" }], // Non-system messages
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
    updatedAt: new Date(),
    createdAt: new Date(),
    tags: [],
    parameters: {},
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

describe("nodeDataToLocalPromptConfig()", () => {
  describe("when node has full inline parameters", () => {
    it("extracts LLM config from parameters array", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: {
              model: "openai/gpt-4",
              temperature: 0.7,
              max_tokens: 1000,
            },
          },
          {
            identifier: "instructions",
            type: "str" as const,
            value: "You are a helpful assistant.",
          },
          {
            identifier: "messages",
            type: "chat_messages" as const,
            value: [{ role: "user", content: "{{input}}" }],
          },
        ],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).not.toBeUndefined();
      expect(result!.llm.model).toBe("openai/gpt-4");
      expect(result!.llm.temperature).toBe(0.7);
      expect(result!.llm.maxTokens).toBe(1000);
      expect(result!.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "{{input}}" },
      ]);
      expect(result!.inputs).toEqual([{ identifier: "input", type: "str" }]);
      expect(result!.outputs).toEqual([{ identifier: "output", type: "str" }]);
    });
  });

  describe("when node has no parameters array", () => {
    it("returns undefined", () => {
      const nodeData = {
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).toBeUndefined();
    });
  });

  describe("when node has empty parameters array", () => {
    it("returns undefined", () => {
      const nodeData = {
        parameters: [],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).toBeUndefined();
    });
  });

  describe("when node has legacy string LLM value", () => {
    it("migrates to object format with model field", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: "openai/gpt-4-0125-preview",
          },
          {
            identifier: "instructions",
            type: "str" as const,
            value: "Be helpful.",
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).not.toBeUndefined();
      expect(result!.llm.model).toBe("openai/gpt-4-0125-preview");
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when node has instructions but no messages parameter", () => {
    it("creates system message from instructions", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: { model: "openai/gpt-4" },
          },
          {
            identifier: "instructions",
            type: "str" as const,
            value: "You are a cat.",
          },
        ],
        inputs: [{ identifier: "query", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).not.toBeUndefined();
      expect(result!.messages).toEqual([
        { role: "system", content: "You are a cat." },
      ]);
    });
  });

  describe("when node has all LLM sampling parameters", () => {
    it("maps snake_case DSL fields to camelCase LocalPromptConfig fields", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: {
              model: "openai/gpt-4",
              temperature: 0.5,
              max_tokens: 2000,
              top_p: 0.9,
              frequency_penalty: 0.3,
              presence_penalty: 0.1,
              seed: 42,
              top_k: 50,
              min_p: 0.05,
              repetition_penalty: 1.1,
              reasoning: "high",
              verbosity: "verbose",
            },
          },
          {
            identifier: "instructions",
            type: "str" as const,
            value: "",
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).not.toBeUndefined();
      expect(result!.llm).toEqual({
        model: "openai/gpt-4",
        temperature: 0.5,
        maxTokens: 2000,
        topP: 0.9,
        frequencyPenalty: 0.3,
        presencePenalty: 0.1,
        seed: 42,
        topK: 50,
        minP: 0.05,
        repetitionPenalty: 1.1,
        reasoning: "high",
        verbosity: "verbose",
      });
    });
  });

  describe("when node has parameters with only llm (no instructions)", () => {
    it("creates config with empty system message", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: { model: "openai/gpt-4" },
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result = nodeDataToLocalPromptConfig(nodeData);

      expect(result).not.toBeUndefined();
      expect(result!.messages).toEqual([{ role: "system", content: "" }]);
    });
  });
});

describe("formValuesToTriggerSaveVersionParams", () => {
  describe("when form values include reasoning", () => {
    /** @scenario "formValuesToTriggerSaveVersionParams includes reasoning" */
    it("propagates reasoning 'high' and omits legacy provider-specific fields", () => {
      const formValues = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "high" } } },
      });

      const result = formValuesToTriggerSaveVersionParams(formValues);

      expect(result.reasoning).toBe("high");
      // Unified field is the canonical sink; legacy provider-specific
      // names must not leak through.
      expect(result).not.toHaveProperty("reasoningEffort");
      expect(result).not.toHaveProperty("thinkingLevel");
      expect(result).not.toHaveProperty("effort");
    });
  });

  describe("when form values omit reasoning", () => {
    /** @scenario "formValuesToTriggerSaveVersionParams handles undefined reasoning" */
    it("returns reasoning undefined and no legacy fields", () => {
      const formValues = buildDefaultFormValues();

      const result = formValuesToTriggerSaveVersionParams(formValues);

      expect(result.reasoning).toBeUndefined();
      expect(result).not.toHaveProperty("reasoningEffort");
    });
  });

  describe("when form values include runtime parameters", () => {
    it("propagates parameters to the save payload", () => {
      /**
       * @scenario Prompt form values preserve runtime parameters during API mapping
       */
      const formValues = buildDefaultFormValues({
        version: { parameters: { mapped: true } },
      });

      const result = formValuesToTriggerSaveVersionParams(formValues);

      expect(result.parameters).toEqual({ mapped: true });
    });
  });
});

describe("formSchema reasoning validation", () => {
  describe("when llm.reasoning is set to a valid value", () => {
    /** @scenario "Form schema accepts reasoning field with valid value" */
    it("accepts 'high'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "high" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });

    /** @scenario Form schema accepts reasoning field with "low" value */
    it("accepts 'low'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "low" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });

    /** @scenario Form schema accepts reasoning field with "medium" value */
    it("accepts 'medium'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "medium" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });
  });

  describe("when llm.reasoning is not set", () => {
    /** @scenario "Form schema accepts undefined reasoning" */
    it("accepts undefined reasoning", () => {
      const values = buildDefaultFormValues();
      expect(formSchema.safeParse(values).success).toBe(true);
      expect(values.version.configData.llm.reasoning).toBeUndefined();
    });
  });
});

describe("formSchema runtime parameters validation", () => {
  describe("when parameters are object JSON", () => {
    it("accepts nested object values", () => {
      /**
       * @scenario Runtime parameters validation accepts object JSON values
       */
      const values = buildDefaultFormValues({
        version: {
          parameters: { nested: { array: [1, true, { leaf: "value" }] } },
        },
      });

      expect(formSchema.safeParse(values).success).toBe(true);
    });
  });

  describe("when parameters root is not an object", () => {
    it("rejects non-object values", () => {
      /**
       * @scenario Runtime parameters validation rejects non-object root values
       */
      for (const params of [null, [1, 2], "value", 1, true]) {
        const values = buildDefaultFormValues({
          version: { parameters: params as any },
        });
        expect(formSchema.safeParse(values).success).toBe(false);
      }
    });
  });
});

/**
 * Regression test for Issue #3196 — Bug 1 ("scaffold default prompt has
 * no system prompt"). The workflow scaffold builds a SignatureNode whose
 * `instructions` parameter holds the default system content; the bridge
 * `nodeDataToLocalPromptConfig` round-trips that into a `messages` array
 * that the prompt editor uses. If the bridge ever loses the system
 * message, the user's first Save attempt will hit the empty-system
 * codepath again.
 *
 * The shape below mirrors the scaffold produced by `registry.ts` (the
 * default LLM signature node). We do NOT import the registry directly
 * to avoid pulling in the full optimization-studio dependency graph in
 * a unit test — the shape is small and stable.
 */
describe("nodeDataToLocalPromptConfig — workflow scaffold round-trip (Issue #3196)", () => {
  // Binds the @e2e scenario at integration scope — the round-trip
  // through the bridge is the bug surface (Bug 1).  Browser-level
  // e2e is queued as a follow-up.
  /** @scenario "New workflow's default prompt node is scaffolded with the default system prompt" */
  it("preserves the registry's default system message when converting the scaffolded signature node to LocalPromptConfig", () => {
    const scaffoldedNodeData = {
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
      parameters: [
        {
          identifier: "llm",
          type: "llm" as const,
          value: {
            model: "openai/gpt-5-mini",
            temperature: 0,
            max_tokens: 2048,
          },
        },
        {
          identifier: "prompting_technique",
          type: "prompting_technique" as const,
          value: undefined,
        },
        {
          identifier: "instructions",
          type: "str" as const,
          value: "You are a helpful assistant.",
        },
        {
          identifier: "messages",
          type: "chat_messages" as const,
          value: [{ role: "user" as const, content: "{{input}}" }],
        },
        {
          identifier: "demonstrations",
          type: "dataset" as const,
          value: undefined,
        },
      ],
    } as any;

    const result = nodeDataToLocalPromptConfig(scaffoldedNodeData);

    expect(result).not.toBeUndefined();
    expect(result!.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "{{input}}" },
    ]);
  });
});
