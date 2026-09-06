import { describe, expect, it } from "vitest";
import { LlmConfigRepository } from "../llm-config.repository";

/**
 * Tests for compareConfigContent covering:
 * - Deep nested object comparison (Root Cause 2: JSON.stringify array replacer bug)
 * - Sampling parameter comparison
 * - Structured output comparison
 */
describe("LlmConfigRepository", () => {
  describe("compareConfigContent()", () => {
    const repository = new LlmConfigRepository(null as any);

    const baseConfig = {
      model: "gpt-4",
      prompt: "You are a helpful assistant",
      messages: [{ role: "user" as const, content: "Hello {{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      temperature: 0.7,
    };

    describe("when configs are identical", () => {
      it("returns isEqual true for identical configs with sampling params", () => {
        const config = {
          ...baseConfig,
          max_tokens: 1000,
          top_p: 0.9,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          seed: 42,
        };

        const result = repository.compareConfigContent(config, { ...config });

        expect(result.isEqual).toBe(true);
      });

      it("returns isEqual true for configs with nested message content", () => {
        const config = {
          ...baseConfig,
          messages: [
            { role: "user" as const, content: "First message {{input}}" },
            { role: "assistant" as const, content: "I'll help you" },
            { role: "user" as const, content: "Follow up question" },
          ],
        };

        const result = repository.compareConfigContent(config, { ...config });

        expect(result.isEqual).toBe(true);
      });

      it("returns isEqual true for configs with structured outputs (json_schema)", () => {
        const config = {
          ...baseConfig,
          outputs: [
            {
              identifier: "response",
              type: "json_schema",
              json_schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  age: { type: "number" },
                },
              },
            },
          ],
        };

        const result = repository.compareConfigContent(config, { ...config });

        expect(result.isEqual).toBe(true);
      });
    });

    describe("when configs have real differences", () => {
      it("detects changes in nested message content", () => {
        const config1 = {
          ...baseConfig,
          messages: [{ role: "user" as const, content: "Hello {{input}}" }],
        };

        const config2 = {
          ...baseConfig,
          messages: [
            { role: "user" as const, content: "Different message {{input}}" },
          ],
        };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(false);
        expect(result.differences).toBeDefined();
        expect(result.differences).toContain("messages differ");
      });

      it("detects changes in sampling parameters", () => {
        const config1 = { ...baseConfig, max_tokens: 1000 };
        const config2 = { ...baseConfig, max_tokens: 2000 };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(false);
      });

      it("detects changes in nested input identifiers", () => {
        const config1 = {
          ...baseConfig,
          inputs: [{ identifier: "input", type: "str" }],
        };
        const config2 = {
          ...baseConfig,
          inputs: [{ identifier: "query", type: "str" }],
        };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(false);
        expect(result.differences).toContain("inputs differ");
      });

      it("detects changes in output json_schema properties", () => {
        const config1 = {
          ...baseConfig,
          outputs: [
            {
              identifier: "response",
              type: "json_schema",
              json_schema: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          ],
        };

        const config2 = {
          ...baseConfig,
          outputs: [
            {
              identifier: "response",
              type: "json_schema",
              json_schema: {
                type: "object",
                properties: { age: { type: "number" } },
              },
            },
          ],
        };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(false);
      });
    });

    describe("when key ordering differs but content is the same", () => {
      it("returns isEqual true regardless of key order in nested objects", () => {
        const config1 = {
          model: "gpt-4",
          prompt: "You are a helpful assistant",
          messages: [{ role: "user" as const, content: "Hello" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          temperature: 0.7,
          max_tokens: 1000,
        };

        // Same content, different key order
        const config2 = {
          max_tokens: 1000,
          temperature: 0.7,
          outputs: [{ type: "str", identifier: "output" }],
          inputs: [{ type: "str", identifier: "input" }],
          messages: [{ content: "Hello", role: "user" as const }],
          prompt: "You are a helpful assistant",
          model: "gpt-4",
        };

        const result = repository.compareConfigContent(config1, config2);

        expect(result.isEqual).toBe(true);
      });
    });
  });
});
