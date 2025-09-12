import { describe, it, expect, beforeEach } from "vitest";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt-response.factory";
import { type CompiledPrompt, Prompt, PromptCompilationError } from "../prompt";
import type { LocalPromptConfig } from "@/cli/types";

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

  describe("#toYaml", () => {
    const prompt = new Prompt(promptResponseFactory.build());

    it("should convert prompt to YAML content structure", () => {
      const yamlContent = prompt.toYaml();

      expect(yamlContent).toHaveProperty("model");
      expect(yamlContent).toHaveProperty("messages");
      expect(yamlContent.model).toBe(prompt.model);
      expect(yamlContent.messages).toEqual(prompt.messages);
    });

    it("should include modelParameters when temperature or maxTokens are set", () => {
      const promptWithParams = new Prompt(promptResponseFactory.build({
        temperature: 0.7,
        maxTokens: 100
      }));

      const yamlContent = promptWithParams.toYaml();

      expect(yamlContent.modelParameters).toEqual({
        temperature: 0.7,
        maxTokens: 100
      });
    });

    it("should include metadata when id, version, or versionId are set", () => {
      const yamlContent = prompt.toYaml();

      expect(yamlContent.metadata).toEqual({
        id: prompt.id,
        version: prompt.version,
        versionId: prompt.versionId
      });
    });

    it("should omit modelParameters when temperature and maxTokens are undefined", () => {
      const promptWithoutParams = new Prompt(promptResponseFactory.build({
        temperature: undefined,
        maxTokens: undefined
      }));

      const yamlContent = promptWithoutParams.toYaml();

      expect(yamlContent).not.toHaveProperty("modelParameters");
    });
  });

  describe("#toYamlString", () => {
    const prompt = new Prompt(promptResponseFactory.build());

    it("should convert prompt to YAML string", () => {
      const yamlString = prompt.toYamlString();

      expect(typeof yamlString).toBe("string");
      expect(yamlString).toContain("model:");
      expect(yamlString).toContain("messages:");
    });
  });

  describe("#fromYaml", () => {
    const sampleConfig: LocalPromptConfig = {
      model: "openai/gpt-4",
      modelParameters: {
        temperature: 0.8,
        max_tokens: 200
      },
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" }
      ]
    };

    it("should create Prompt from YAML config", () => {
      const prompt = Prompt.fromYaml(sampleConfig);

      expect(prompt.model).toBe("openai/gpt-4");
      expect(prompt.temperature).toBe(0.8);
      expect(prompt.maxTokens).toBe(200);
      expect(prompt.messages).toEqual(sampleConfig.messages);
      expect(prompt.prompt).toBe("You are a helpful assistant.");
    });

    it("should use provided options for metadata", () => {
      const options = {
        handle: "test-prompt",
        id: "test-id",
        version: 5,
        versionId: "v5"
      };

      const prompt = Prompt.fromYaml(sampleConfig, options);

      expect(prompt.handle).toBe("test-prompt");
      expect(prompt.id).toBe("test-id");
      expect(prompt.version).toBe(5);
      expect(prompt.versionId).toBe("v5");
    });

    it("should use defaults when options are not provided", () => {
      const prompt = Prompt.fromYaml(sampleConfig);

      expect(prompt.handle).toBe("local");
      expect(prompt.id).toBe("local");
      expect(prompt.version).toBe(0);
      expect(prompt.versionId).toBe("local");
    });

    it("should handle config without modelParameters", () => {
      const configWithoutParams: LocalPromptConfig = {
        model: "openai/gpt-3.5-turbo",
        messages: [
          { role: "user", content: "Test message" }
        ]
      };

      const prompt = Prompt.fromYaml(configWithoutParams);

      expect(prompt.model).toBe("openai/gpt-3.5-turbo");
      expect(prompt.temperature).toBeUndefined();
      expect(prompt.maxTokens).toBeUndefined();
    });
  });

  describe("#fromYamlString", () => {
    const yamlString = `
model: openai/gpt-4
modelParameters:
  temperature: 0.9
  max_tokens: 150
messages:
  - role: system
    content: You are a creative assistant.
  - role: user
    content: Write a poem.
`;

    it("should create Prompt from YAML string", () => {
      const prompt = Prompt.fromYamlString(yamlString);

      expect(prompt.model).toBe("openai/gpt-4");
      expect(prompt.temperature).toBe(0.9);
      expect(prompt.maxTokens).toBe(150);
      expect(prompt.messages).toHaveLength(2);
      expect(prompt.prompt).toBe("You are a creative assistant.");
    });

    it("should use provided options", () => {
      const options = {
        handle: "poem-writer",
        version: 2
      };

      const prompt = Prompt.fromYamlString(yamlString, options);

      expect(prompt.handle).toBe("poem-writer");
      expect(prompt.version).toBe(2);
    });
  });

  describe("YAML roundtrip", () => {
    it("should maintain data integrity through toYaml -> fromYaml roundtrip", () => {
      const originalPrompt = new Prompt(promptResponseFactory.build({
        model: "openai/gpt-4",
        temperature: 0.7,
        maxTokens: 100
      }));

      // Convert to YAML and back
      const yamlContent = originalPrompt.toYaml();
      const recreatedPrompt = Prompt.fromYaml({
        model: yamlContent.model,
        modelParameters: yamlContent.modelParameters ? {
          temperature: yamlContent.modelParameters.temperature,
          max_tokens: yamlContent.modelParameters.maxTokens
        } : undefined,
        messages: yamlContent.messages
      }, {
        handle: originalPrompt.handle ?? undefined,
        id: originalPrompt.id,
        version: originalPrompt.version,
        versionId: originalPrompt.versionId
      });

      expect(recreatedPrompt.model).toBe(originalPrompt.model);
      expect(recreatedPrompt.temperature).toBe(originalPrompt.temperature);
      expect(recreatedPrompt.maxTokens).toBe(originalPrompt.maxTokens);
      expect(recreatedPrompt.messages).toEqual(originalPrompt.messages);
      expect(recreatedPrompt.handle).toBe(originalPrompt.handle);
    });
  });
});
