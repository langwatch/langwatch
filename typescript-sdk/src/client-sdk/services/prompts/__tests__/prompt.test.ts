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

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
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

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
      expect(result.messages[1]?.content).toBe("Tell me about weather");
    });

    it("should throw on strict compilation with missing variables", () => {
      expect(() => {
        prompt.compileStrict({});
      }).toThrow(PromptCompilationError);
    });
  });

  describe("tags exposure", () => {
    describe("when API response includes tags", () => {
      it("exposes them on the Prompt instance", () => {
        const prompt = new Prompt(
          promptResponseFactory.build({
            tags: [
              { name: "latest", versionId: "v123" },
              { name: "production", versionId: "v123" },
            ],
          }),
        );
        expect(prompt.tags).toEqual([
          { name: "latest", versionId: "v123" },
          { name: "production", versionId: "v123" },
        ]);
      });
    });

    describe("when API response omits tags", () => {
      it("defaults to an empty array", () => {
        const data = promptResponseFactory.build();
        delete (data as { tags?: unknown }).tags;
        const prompt = new Prompt(data);
        expect(prompt.tags).toEqual([]);
      });
    });
  });
});
