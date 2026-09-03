import { describe, expect, it } from "vitest";

import type { VersionedPrompt } from "@langwatch/prompt-contract";

import { versionedPromptToPromptConfigFormValues } from "../versioned-prompt-form-values";

describe("versionedPromptToPromptConfigFormValues", () => {
  /**
   * Creates a mock VersionedPrompt for testing handle extraction
   */
  const createMockPrompt = (handle: string | null): VersionedPrompt => ({
    id: "prompt-1",
    name: "test-prompt",
    handle: handle,
    scope: "PROJECT",
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

  /**
   * The form derives the demonstration columns from the inputs and outputs and
   * writes them into itself on load, so a baseline built from the stored prompt
   * has to carry the same columns or an untouched prompt reads as modified.
   *
   * @see specs/prompts/prompt-editor-dirty-state.feature
   */
  describe("when the prompt has inputs and outputs", () => {
    /** @scenario "A stored prompt carries the demonstration columns its fields imply" */
    it("derives the demonstration columns the form settles on", () => {
      const prompt = createMockPrompt("gato");
      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.configData.demonstrations?.inline?.columnTypes).toEqual([
        { id: "input", name: "input", type: "string" },
        { id: "output", name: "output", type: "string" },
      ]);
    });

    /** @scenario "A stored prompt carries the demonstration columns its fields imply" */
    it("keeps the stored demonstration records", () => {
      const prompt = {
        ...createMockPrompt("gato"),
        demonstrations: {
          inline: {
            columnTypes: [],
            records: { input: ["a question"] },
          },
        },
      } as VersionedPrompt;

      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.configData.demonstrations?.inline?.records).toEqual({
        input: ["a question"],
      });
    });
  });

  describe("when the stored demonstrations already carry the derived columns", () => {
    /** @scenario "Stored demonstrations that already match are left alone" */
    it("leaves them as they were stored", () => {
      const demonstrations = {
        inline: {
          columnTypes: [
            { id: "input", name: "input", type: "string" as const },
            { id: "output", name: "output", type: "string" as const },
          ],
          records: { input: ["a question"] },
        },
      };
      const prompt = {
        ...createMockPrompt("gato"),
        demonstrations,
      } as VersionedPrompt;

      const result = versionedPromptToPromptConfigFormValues(prompt);

      expect(result.version.configData.demonstrations).toEqual(demonstrations);
    });
  });

  describe("when prompt handle has no prefix", () => {
    it("keeps simple handle unchanged", () => {
      const result = versionedPromptToPromptConfigFormValues(createMockPrompt("gato"));
      expect(result.handle).toBe("gato");
    });

    it("keeps folder handle unchanged", () => {
      const result = versionedPromptToPromptConfigFormValues(createMockPrompt("folder/gato"));
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
      const result = versionedPromptToPromptConfigFormValues(createMockPrompt(null));
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
