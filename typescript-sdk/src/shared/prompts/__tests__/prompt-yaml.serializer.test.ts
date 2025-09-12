import { describe, it, expect } from "vitest";
import { PromptYamlSerializer } from "../prompt-yaml.serializer";
import { promptResponseFactory } from "../../../../__tests__/factories/prompt-response.factory";
import { Prompt } from "@/client-sdk/services/prompts/prompt";

describe("PromptYamlSerializer", () => {
  describe("#serialize", () => {
    it("should convert prompt to YAML string", () => {
      const prompt = new Prompt(promptResponseFactory.build());

      const yamlString = PromptYamlSerializer.serialize(prompt);

      expect(typeof yamlString).toBe("string");
      expect(yamlString).toMatchInlineSnapshot(`
        "model: gpt-5
        messages:
          - role: system
            content: You are a helpful assistant.
          - role: user
            content: Tell me about {{topic}}
        metadata:
          id: prompt_1
          version: 1
          versionId: prompt_version_1
        "
      `);
    });
  });


  describe("#deserialize", () => {
    it("should convert YAML string back to prompt data", () => {
      const yamlString = `
model: openai/gpt-4
modelParameters:
  temperature: 0.7
  maxTokens: 100
messages:
  - role: system
    content: You are a helpful assistant.
  - role: user
    content: Hello!
metadata:
  id: test-id
  version: 1
  versionId: v1
`;

      const result = PromptYamlSerializer.deserialize(yamlString);
      expect(result).toBeInstanceOf(Prompt);
      expect(result.model).toBe("openai/gpt-4");
      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(100);
      expect(result.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" }
      ]);
      expect(result.id).toBe("test-id");
      expect(result.version).toBe(1);
      expect(result.versionId).toBe("v1");
    });
  });
});
