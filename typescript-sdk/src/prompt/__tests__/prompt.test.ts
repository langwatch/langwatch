import { describe, it, expect, beforeEach } from "vitest";
import { promptResponseFactory } from "../../../__tests__/factories/prompt.factory";
import { CompiledPrompt, Prompt, PromptCompilationError } from "../prompt";

describe("Prompt", () => {
  describe("#compile", () => {
    const prompt = new Prompt(promptResponseFactory.build());
    let result: CompiledPrompt;

    beforeEach(async () => {
      // Test template compilation
      result = prompt.compile({
        user_name: "Alice",
        topic: "weather",
      });
    });

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
      expect(result.messages[0]?.content).toBe("Tell me about weather");
    });
  });

  describe("#compileStrict", () => {
    const prompt = new Prompt(promptResponseFactory.build());
    let result: CompiledPrompt;

    beforeEach(async () => {
      // Test template compilation
      result = prompt.compile({
        user_name: "Alice",
        topic: "weather",
      });
    });

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
      expect(result.messages[0]?.content).toBe("Tell me about weather");
    });

    it("should throw on strict compilation with missing variables", () => {
      expect(() => {
        prompt.compileStrict({});
      }).toThrow(PromptCompilationError);
    });
  });
});
