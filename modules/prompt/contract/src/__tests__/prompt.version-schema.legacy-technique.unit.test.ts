import {
  LATEST_SCHEMA_VERSION,
  getSchemaValidator,
  parseLlmConfigVersion,
} from "@langwatch/prompt-contract";
import { describe, expect, it, vi } from "vitest";

function versionWith(promptingTechnique: unknown) {
  return {
    id: "promptversion_v1",
    configId: "prompt_1",
    projectId: "project-1",
    version: 1,
    schemaVersion: LATEST_SCHEMA_VERSION,
    commitMessage: "Initial version",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    authorId: null,
    author: null,
    configData: {
      prompt: "hello",
      messages: [],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      model: "openai/gpt-5-mini",
      prompting_technique: promptingTechnique,
    },
  };
}

describe("parseLlmConfigVersion with a legacy prompting_technique", () => {
  describe("when the stored type is spelled differently", () => {
    it.each([
      ["ChainOfThought", "chain_of_thought"],
      ["chain-of-thought", "chain_of_thought"],
      ["COT", "chain_of_thought"],
      ["FewShot", "few_shot"],
      ["few-shot", "few_shot"],
      ["in-context", "in_context"],
    ])("maps %s to %s", (stored, expected) => {
      const onChange = vi.fn();
      const parsed = parseLlmConfigVersion(versionWith({ type: stored }), {
        onLegacyPromptingTechnique: onChange,
      });
      expect(parsed.configData.prompting_technique).toEqual({ type: expected });
      expect(onChange).toHaveBeenCalledWith({
        storedShape: "object",
        action: "mapped",
        mappedTo: expected,
      });
    });

    it("keeps valid demonstrations", () => {
      const demonstrations = {
        columns: [{ id: "a", name: "a", type: "string" }],
        rows: [{ id: "r1", a: "x" }],
      };
      const parsed = parseLlmConfigVersion(versionWith({ type: "ChainOfThought", demonstrations }));
      expect(parsed.configData.prompting_technique?.type).toBe("chain_of_thought");
      expect(parsed.configData.prompting_technique?.demonstrations).toBeDefined();
    });
  });

  describe("when the stored value is a bare string", () => {
    it("maps a known string to an object", () => {
      const parsed = parseLlmConfigVersion(versionWith("chain_of_thought"));
      expect(parsed.configData.prompting_technique).toEqual({ type: "chain_of_thought" });
    });
  });

  describe("when the stored value has no equivalent", () => {
    it.each([
      ["null", null, "null"],
      ["unknown type", { type: "something_else" }, "object"],
      ["missing type", {}, "object"],
      ["null type", { type: null }, "object"],
      ["unknown string", "mystery", "string"],
      ["number", 3, "number"],
      ["array", [], "array"],
    ])("drops it (%s) and reports a warning", (_name, stored, shape) => {
      const onChange = vi.fn();
      const parsed = parseLlmConfigVersion(versionWith(stored), {
        onLegacyPromptingTechnique: onChange,
      });
      expect(parsed.configData.prompting_technique).toBeUndefined();
      expect(onChange).toHaveBeenCalledWith({ storedShape: shape, action: "dropped" });
    });
  });

  describe("when the stored value is already valid", () => {
    it("passes through without a warning", () => {
      const onChange = vi.fn();
      const parsed = parseLlmConfigVersion(versionWith({ type: "few_shot" }), {
        onLegacyPromptingTechnique: onChange,
      });
      expect(parsed.configData.prompting_technique).toEqual({ type: "few_shot" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("when writing new data", () => {
    it("still rejects legacy values with the strict validator", () => {
      const result = getSchemaValidator(LATEST_SCHEMA_VERSION).safeParse(
        versionWith({ type: "ChainOfThought" }),
      );
      expect(result.success).toBe(false);
    });
  });
});
