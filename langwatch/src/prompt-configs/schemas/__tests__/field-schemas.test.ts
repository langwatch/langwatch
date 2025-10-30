import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("Field Schemas", () => {
  describe("Message Schema", () => {
    const messageSchema = z.object({
      role: z.enum(["system", "user", "assistant", "function", "tool"]),
      content: z.string(),
    });

    it("should validate system message", () => {
      const message = {
        role: "system" as const,
        content: "You are a helpful assistant.",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should validate user message", () => {
      const message = {
        role: "user" as const,
        content: "Hello",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should validate assistant message", () => {
      const message = {
        role: "assistant" as const,
        content: "Hi there!",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should reject invalid role", () => {
      const message = {
        role: "invalid",
        content: "Test",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it("should require content field", () => {
      const message = {
        role: "user",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it("should handle empty content", () => {
      const message = {
        role: "user" as const,
        content: "",
      };

      const result = messageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe("LLM Config Schema", () => {
    const llmConfigSchema = z.object({
      model: z.string(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(1).optional(),
      topP: z.number().min(0).max(1).optional(),
      presencePenalty: z.number().min(-2).max(2).optional(),
      frequencyPenalty: z.number().min(-2).max(2).optional(),
    });

    it("should validate minimal LLM config", () => {
      const config = {
        model: "gpt-4",
      };

      const result = llmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should validate complete LLM config", () => {
      const config = {
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 1000,
        topP: 0.9,
        presencePenalty: 0.5,
        frequencyPenalty: 0.3,
      };

      const result = llmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should reject temperature out of range", () => {
      const config = {
        model: "gpt-4",
        temperature: 3.0,
      };

      const result = llmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject topP out of range", () => {
      const config = {
        model: "gpt-4",
        topP: 1.5,
      };

      const result = llmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject negative maxTokens", () => {
      const config = {
        model: "gpt-4",
        maxTokens: 0,
      };

      const result = llmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should validate edge case temperature values", () => {
      const config1 = { model: "gpt-4", temperature: 0 };
      const config2 = { model: "gpt-4", temperature: 2 };

      expect(llmConfigSchema.safeParse(config1).success).toBe(true);
      expect(llmConfigSchema.safeParse(config2).success).toBe(true);
    });
  });

  describe("Input/Output Schema", () => {
    const ioSchema = z.object({
      identifier: z.string(),
      type: z.enum(["str", "int", "float", "bool", "list[str]", "json_schema"]),
    });

    it("should validate string input", () => {
      const input = {
        identifier: "query",
        type: "str" as const,
      };

      const result = ioSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate all types", () => {
      const types = ["str", "int", "float", "bool", "list[str]", "json_schema"];

      types.forEach((type) => {
        const input = {
          identifier: "test",
          type,
        };
        const result = ioSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid type", () => {
      const input = {
        identifier: "test",
        type: "invalid",
      };

      const result = ioSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should require identifier", () => {
      const input = {
        type: "str",
      };

      const result = ioSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("Scope Schema", () => {
    const scopeSchema = z.enum(["PROJECT", "ORGANIZATION"]);

    it("should validate PROJECT scope", () => {
      const result = scopeSchema.safeParse("PROJECT");
      expect(result.success).toBe(true);
    });

    it("should validate ORGANIZATION scope", () => {
      const result = scopeSchema.safeParse("ORGANIZATION");
      expect(result.success).toBe(true);
    });

    it("should reject invalid scope", () => {
      const result = scopeSchema.safeParse("INVALID");
      expect(result.success).toBe(false);
    });

    it("should reject lowercase scope", () => {
      const result = scopeSchema.safeParse("project");
      expect(result.success).toBe(false);
    });
  });

  describe("Prompting Technique Schema", () => {
    const promptingTechniqueSchema = z
      .enum(["cot", "few_shot", "react", "self_consistency"])
      .optional();

    it("should validate chain-of-thought", () => {
      const result = promptingTechniqueSchema.safeParse("cot");
      expect(result.success).toBe(true);
    });

    it("should validate few-shot", () => {
      const result = promptingTechniqueSchema.safeParse("few_shot");
      expect(result.success).toBe(true);
    });

    it("should validate react", () => {
      const result = promptingTechniqueSchema.safeParse("react");
      expect(result.success).toBe(true);
    });

    it("should validate self-consistency", () => {
      const result = promptingTechniqueSchema.safeParse("self_consistency");
      expect(result.success).toBe(true);
    });

    it("should allow undefined", () => {
      const result = promptingTechniqueSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("should reject invalid technique", () => {
      const result = promptingTechniqueSchema.safeParse("invalid");
      expect(result.success).toBe(false);
    });
  });

  describe("Runtime Inputs Schema", () => {
    it("should validate runtime inputs as record", () => {
      const schema = z.record(z.string(), z.any());

      const inputs = {
        input1: "value1",
        input2: 42,
        input3: { nested: "object" },
      };

      const result = schema.safeParse(inputs);
      expect(result.success).toBe(true);
    });

    it("should handle empty runtime inputs", () => {
      const schema = z.record(z.string(), z.any());

      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});