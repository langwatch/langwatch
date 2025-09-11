import { describe, it, beforeEach, expect } from "vitest";
import { MaterializedPromptLoaderService } from "../service";
import { FileManager } from "@/cli/utils/fileManager";

describe("MaterializedPromptLoader", () => {
  let service: MaterializedPromptLoaderService;

  beforeEach(() => {
    service = new MaterializedPromptLoaderService();
  });

  describe("#get()", () => {
    describe("when not loaded", () => {
      it("should throw an error", () => {
        expect(() => service.get("test")).toThrow(
          "Materialized prompts not loaded. Call load() first.",
        );
      });
    });

    describe("when loaded", () => {
      const prompt = {
        name: "test",
        version: 1,
        versionId: "1",
        model: "openai/gpt-5",
        messages: [],
        prompt: "test",
        temperature: 0,
        maxTokens: 100,
        inputs: {},
        outputs: {},
        updatedAt: new Date().toISOString(),
      };

      beforeEach(async () => {
        // load prompts
        FileManager.saveMaterializedPrompt("test", {
          ...prompt,
          id: "1",
        });

        FileManager.saveMaterializedPrompt("test/nested", {
          ...prompt,
          id: "2",
        });

        await service.load();
      });

      describe("when the prompt is found", () => {
        it("returns the prompt", () => {
          expect(service.get("test")).toEqual({
            model: "openai/gpt-5",
            messages: [],
            modelParameters: {
              temperature: 0,
              maxTokens: 100,
            },
          });

          expect(service.get("test/nested")).toEqual({
            model: "openai/gpt-5",
            messages: [],
            modelParameters: {
              temperature: 0,
              maxTokens: 100,
            },
          });
        });
      });

      describe("when the prompt is not found", () => {
        it("returns null", () => {
          expect(service.get("test/not-found")).toBeNull();
        });
      });
    });
  });
});
