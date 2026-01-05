import { describe, it, expect } from "vitest";
import { buildDefaultFormValues } from "../buildDefaultFormValues";

describe("buildDefaultFormValues", () => {
  describe("unified defaults", () => {
    it("creates prompt with input variable", () => {
      const defaults = buildDefaultFormValues();

      expect(defaults.version.configData.inputs).toHaveLength(1);
      expect(defaults.version.configData.inputs[0]).toEqual({
        identifier: "input",
        type: "str",
      });
    });

    it("creates prompt with output variable", () => {
      const defaults = buildDefaultFormValues();

      expect(defaults.version.configData.outputs).toHaveLength(1);
      expect(defaults.version.configData.outputs[0]).toEqual({
        identifier: "output",
        type: "str",
      });
    });

    it("creates system message with default content", () => {
      const defaults = buildDefaultFormValues();
      const systemMessage = defaults.version.configData.messages.find(
        (m) => m.role === "system"
      );

      expect(systemMessage).toBeDefined();
      expect(systemMessage?.content).toBe("You are a helpful assistant.");
    });

    it("creates user message with {{input}} variable", () => {
      const defaults = buildDefaultFormValues();
      const userMessage = defaults.version.configData.messages.find(
        (m) => m.role === "user"
      );

      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe("{{input}}");
    });

    it("has exactly 2 messages (system and user)", () => {
      const defaults = buildDefaultFormValues();

      expect(defaults.version.configData.messages).toHaveLength(2);
      expect(defaults.version.configData.messages[0]?.role).toBe("system");
      expect(defaults.version.configData.messages[1]?.role).toBe("user");
    });
  });

  describe("with overrides", () => {
    it("allows overriding the model", () => {
      const defaults = buildDefaultFormValues({
        version: {
          configData: {
            llm: { model: "anthropic/claude-sonnet-4-20250514" },
          },
        },
      });

      expect(defaults.version.configData.llm.model).toBe(
        "anthropic/claude-sonnet-4-20250514"
      );
      // Other defaults should be preserved
      expect(defaults.version.configData.inputs[0]?.identifier).toBe("input");
    });

    it("preserves default temperature when only model is overridden", () => {
      const defaults = buildDefaultFormValues({
        version: {
          configData: {
            llm: { model: "openai/gpt-4o" },
          },
        },
      });

      expect(defaults.version.configData.llm.temperature).toBe(1);
    });

    it("allows overriding handle", () => {
      const defaults = buildDefaultFormValues({
        handle: "my-prompt",
      });

      expect(defaults.handle).toBe("my-prompt");
    });
  });

  describe("llm configuration", () => {
    it("sets temperature to 1 by default (for GPT-5 compatibility)", () => {
      const defaults = buildDefaultFormValues();

      expect(defaults.version.configData.llm.temperature).toBe(1);
    });

    it("sets maxTokens to 1000 by default", () => {
      const defaults = buildDefaultFormValues();

      expect(defaults.version.configData.llm.maxTokens).toBe(1000);
    });
  });
});
