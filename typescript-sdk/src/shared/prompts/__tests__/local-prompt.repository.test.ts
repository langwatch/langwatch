import { describe, it, expect } from "vitest";
import { LocalPromptRepository } from "../local-prompt.repository";
import { Prompt } from "@/client-sdk/services/prompts/prompt";
import { promptResponseFactory } from "../../../../__tests__/factories/prompt.factory";
import * as fs from "fs/promises";
import * as path from "path";
import * as expectations from "../../../__tests__/test-utils/expecations";

describe("LocalPromptRepository", () => {
  const repository = new LocalPromptRepository();
  const testNames = ["my-prompt", "nested/my-prompt"];

  it("returns null for non-existent prompt", async () => {
    const result = await repository.loadPrompt("does-not-exist");
    expect(result).toBeNull();
  });

  // Snapshot tests -- can't be run in a loop
  describe("savePrompt", () => {
    it(`saves a prompt to prompts/ directory for my-prompt`, async () => {
      const prompt = new Prompt(
        promptResponseFactory.build({
          model: "openai/gpt-4",
          temperature: 0.7,
        }),
      );

      await repository.savePrompt("my-prompt", prompt);

      const filePath = path.join("prompts", `${"my-prompt"}.prompt.yaml`);
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
    it(`saves a materialized prompt to .materialized/ directory for my-prompt`, async () => {
      const prompt = new Prompt(
        promptResponseFactory.build({
          model: "openai/gpt-3.5-turbo",
          maxTokens: 150,
        }),
      );

      await repository.savePromptMaterialized("my-prompt", prompt);

      const filePath = path.join(".materialized", `${"my-prompt"}.prompt.yaml`);
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

  testNames.forEach((name) => {
    describe("savePrompt", () => {
      it(`saves a prompt to prompts/ directory for ${name}`, async () => {
        const prompt = new Prompt(promptResponseFactory.build());
        await repository.savePrompt(name, prompt);
        const loaded = await repository.loadPrompt(name);
        expectations.toMatchPrompt(loaded, prompt);
      });
    });

    describe("savePromptMaterialized", () => {
      it(`saves a materialized prompt to .materialized/ directory for ${name}`, async () => {
        const prompt = new Prompt(promptResponseFactory.build());
        await repository.savePromptMaterialized(name, prompt);
        const loaded = await repository.loadPromptMaterialized(name);
        expectations.toMatchPrompt(loaded, prompt);
      });
    });

    describe("loadPrompt", () => {
      it(`loads a prompt from prompts/ directory for ${name}`, async () => {
        const originalPrompt = new Prompt(
          promptResponseFactory.build({
            model: "claude-3",
            temperature: 0.5,
          }),
        );

        await repository.savePrompt(name, originalPrompt);
        const loaded = await repository.loadPrompt(name);

        expectations.toMatchPrompt(loaded, originalPrompt);
      });
    });

    describe("loadPromptMaterialized", () => {
      it(`loads a materialized prompt from .materialized/ directory for ${name}`, async () => {
        const originalPrompt = new Prompt(
          promptResponseFactory.build({
            model: "openai/gpt-4-turbo",
            temperature: 0.9,
          }),
        );

        await repository.savePromptMaterialized(name, originalPrompt);
        const loaded = await repository.loadPromptMaterialized(name);

        expectations.toMatchPrompt(loaded, originalPrompt);
      });
    });

    it("returns null for non-existent materialized prompt", async () => {
      const result = await repository.loadPromptMaterialized("missing-cached");
      expect(result).toBeNull();
    });

    describe("deletePrompt", () => {
      it("deletes a prompt from prompts/ directory", async () => {
        const prompt = new Prompt(promptResponseFactory.build());

        // Save and verify it exists
        await repository.savePrompt(name, prompt);
        let loaded = await repository.loadPrompt(name);
        expect(loaded).not.toBeNull();

        // Delete and verify it's gone
        await repository.deletePrompt(name);
        loaded = await repository.loadPrompt(name);
        expect(loaded).toBeNull();
      });

      it("does not throw when deleting non-existent prompt", async () => {
        await expect(repository.deletePrompt(name)).resolves.not.toThrow();
      });
    });

    describe("deletePromptMaterialized", () => {
      it("deletes a materialized prompt from .materialized/ directory", async () => {
        const prompt = new Prompt(promptResponseFactory.build());

        // Save and verify it exists
        await repository.savePromptMaterialized(name, prompt);
        let loaded = await repository.loadPromptMaterialized(name);
        expect(loaded).not.toBeNull();

        // Delete and verify it's gone
        await repository.deletePromptMaterialized(name);
        loaded = await repository.loadPromptMaterialized(name);
        expect(loaded).toBeNull();
      });

      it("does not throw when deleting non-existent materialized prompt", async () => {
        await expect(
          repository.deletePromptMaterialized(name),
        ).resolves.not.toThrow();
      });
    });
  });
});
