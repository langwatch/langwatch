import { describe, it, expect, afterEach } from "vitest";
import { InMemoryPromptLoader, DuplicatePromptFoundError } from "../in-memory-prompt-loader";
import { Prompt } from "@/client-sdk/services/prompts/prompt";
import { promptResponseFactory } from "../../../../__tests__/factories/prompt.factory";
import { LocalPromptRepository } from "../local-prompt.repository";
import * as expectations from "../../../__tests__/test-utils/expecations";

describe("InMemoryPromptLoader", () => {
  const loader = new InMemoryPromptLoader();
  const repository = new LocalPromptRepository();
  const testNames = ["my-prompt", "nested/my-prompt"];

  describe("get", () => {
    testNames.forEach((name) => {
      afterEach(async () => {
        await Promise.all([
          await repository.deletePrompt(name),
          await repository.deletePromptMaterialized(name)
        ]);
      });

      it("loads a regular prompt by name", async () => {
        const originalPrompt = new Prompt(
          promptResponseFactory.build({
            model: "openai/gpt-4",
            temperature: 0.7,
          }),
        );

        await repository.savePrompt(name, originalPrompt);
        const loaded = await loader.get(name);

        expectations.toMatchPrompt(loaded, originalPrompt);
      });

      it("loads a materialized prompt by name", async () => {
        const originalPrompt = new Prompt(
          promptResponseFactory.build({
            model: "claude-3",
            maxTokens: 100,
          }),
        );

        await repository.savePromptMaterialized(name, originalPrompt);
        const loaded = await loader.get(name);

        console.log(loaded);

        expectations.toMatchPrompt(loaded, originalPrompt);
      });

      it("throws DuplicatePromptFoundError when prompt exists in both directories", async () => {
        const regularPrompt = new Prompt(
          promptResponseFactory.build({
            model: "openai/gpt-4",
            temperature: 0.7,
          }),
        );

        const materializedPrompt = new Prompt(
          promptResponseFactory.build({
            model: "claude-3",
            maxTokens: 100,
          }),
        );

        await repository.savePrompt(name, regularPrompt);
        await repository.savePromptMaterialized(name, materializedPrompt);

        await expect(loader.get(name)).rejects.toThrow(DuplicatePromptFoundError);
        await expect(loader.get(name)).rejects.toThrow(
          `Duplicate prompt found: '${name}' exists in both prompts/ and .materialized/ directories`
        );
      });
    });

    it("returns null when prompt not found", async () => {
      const result = await loader.get("non-existent");
      expect(result).toBeNull();
    });

    it('thows an error when prompt exists in both directories', async () => {
      const name = "my-prompt";

      const regularPrompt = new Prompt(
        promptResponseFactory.build({
          model: "openai/gpt-4",
          temperature: 0.7,
        }),
      );

      const materializedPrompt = new Prompt(
        promptResponseFactory.build({
          model: "claude-3",
          maxTokens: 100,
        }),
      );

      await Promise.all([
        await repository.savePrompt(name, regularPrompt),
        await repository.savePromptMaterialized(name, materializedPrompt)
      ]);

      await expect(loader.get(name)).rejects.toThrow(DuplicatePromptFoundError);

      // Cleanup
      await Promise.all([
        await repository.deletePrompt(name),
        await repository.deletePromptMaterialized(name)
      ]);
    });
  });
});
