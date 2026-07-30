import { describe, it, expect, beforeEach } from "vitest";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { type CompiledPrompt, Prompt, PromptCompilationError } from "../prompt";

describe("Prompt", () => {
  describe("#compile", () => {
    const prompt = new Prompt(promptResponseFactory.build());
    let result: CompiledPrompt;

    beforeEach(async () => {
      // Test template compilation
      result = prompt.compile({
        name: "Alice",
        topic: "weather",
      });
    });

    it("compiles a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("compiles the messages", () => {
      expect(result.messages[1]?.content).toBe("Tell me about weather");
    });
  });

  describe("#compileStrict", () => {
    const prompt = new Prompt(promptResponseFactory.build());
    let result: CompiledPrompt;

    beforeEach(async () => {
      // Test template compilation
      result = prompt.compileStrict({
        name: "Alice",
        topic: "weather",
      });
    });

    it("compiles a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("compiles the messages", () => {
      expect(result.messages[1]?.content).toBe("Tell me about weather");
    });

    it("throws on strict compilation with missing variables", () => {
      expect(() => {
        prompt.compileStrict({});
      }).toThrow(PromptCompilationError);
    });
  });
});
