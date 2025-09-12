import { describe, it, expect } from "vitest";
import { LocalPromptRepository } from "../local-prompt-repository";
import { Prompt } from "@/client-sdk/services/prompts/prompt";
import { promptResponseFactory } from "../../../../__tests__/factories/prompt-response.factory";
import * as fs from "fs/promises";
import * as path from "path";

function toMatchPrompt(actual: any, expected: Prompt) {
  expect(actual.model).toBe(expected.model);
  expect(actual.temperature).toBe(expected.temperature);
  expect(actual.messages).toEqual(expected.messages);
  expect(actual.prompt).toBe(expected.prompt);
  expect(actual.version).toBe(expected.version);
  expect(actual.versionId).toBe(expected.versionId);
}

const expectations = {
  toMatchPrompt,
};

describe("LocalPromptRepository", () => {
  const repository = new LocalPromptRepository();

  describe("savePrompt", () => {
    it("saves a prompt to prompts/ directory", async () => {
      const prompt = new Prompt(promptResponseFactory.build({
        model: "openai/gpt-4",
        temperature: 0.7
      }));

      await repository.savePrompt("test-prompt", prompt);

      const filePath = path.join("prompts", "test-prompt.prompt.yaml");
      const fileContent = await fs.readFile(filePath, "utf-8");
      expect(fileContent).toMatchInlineSnapshot(`
        "model: openai/gpt-4
        messages:
          - role: system
            content: You are a helpful assistant.
          - role: user
            content: Tell me about {{topic}}
        modelParameters:
          temperature: 0.7
        metadata:
          id: prompt_1
          version: 1
          versionId: prompt_version_1
        "
      `);
    });
  });

  describe("savePromptMaterialized", () => {
    it("saves a materialized prompt to .materialized/ directory", async () => {
      const prompt = new Prompt(promptResponseFactory.build({
        model: "openai/gpt-3.5-turbo",
        maxTokens: 150
      }));

      await repository.savePromptMaterialized("api-prompt", prompt);

      const filePath = path.join(".materialized", "api-prompt.prompt.yaml");
      const fileContent = await fs.readFile(filePath, "utf-8");
      expect(fileContent).toMatchInlineSnapshot(`
        "model: openai/gpt-3.5-turbo
        messages:
          - role: system
            content: You are a helpful assistant.
          - role: user
            content: Tell me about {{topic}}
        modelParameters:
          maxTokens: 150
        metadata:
          id: prompt_2
          version: 1
          versionId: prompt_version_2
        "
      `);
    });
  });

  describe("loadPrompt", () => {
    it("loads a prompt from prompts/ directory", async () => {
      const originalPrompt = new Prompt(promptResponseFactory.build({
        model: "claude-3",
        temperature: 0.5
      }));

      await repository.savePrompt("my-prompt", originalPrompt);
      const loaded = await repository.loadPrompt("my-prompt");

      expectations.toMatchPrompt(loaded, originalPrompt);
    });

    it("returns null for non-existent prompt", async () => {
      const result = await repository.loadPrompt("does-not-exist");
      expect(result).toBeNull();
    });
  });

  describe("loadPromptMaterialized", () => {
    it("loads a materialized prompt from .materialized/ directory", async () => {
      const originalPrompt = new Prompt(promptResponseFactory.build({
        model: "openai/gpt-4-turbo",
        temperature: 0.9
      }));

      await repository.savePromptMaterialized("cached-prompt", originalPrompt);
      const loaded = await repository.loadPromptMaterialized("cached-prompt");

      expectations.toMatchPrompt(loaded, originalPrompt);
    });

    it("returns null for non-existent materialized prompt", async () => {
      const result = await repository.loadPromptMaterialized("missing-cached");
      expect(result).toBeNull();
    });
  });
});
