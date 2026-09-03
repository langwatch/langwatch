import { describe, expect, it } from "vitest";
import type { PromptDetailResponse, PromptMutationResponse } from "../langwatch-api.js";

describe("Prompt response type interfaces", () => {
  describe("given fully-populated PromptDetailResponse and PromptMutationResponse fixtures", () => {
    /** @scenario Declaring every rendered field on the typed response interfaces */
    it("declares every field the prompt tools render, with no `as` cast needed", () => {
      // Mirrors apiResponsePromptWithVersionDataSchema (the real GET
      // /api/prompts/:id contract): version data flattened to the top level,
      // parameters as an object map, tags as { name, versionId } objects,
      // and no nested versions array.
      const detail: PromptDetailResponse = {
        id: "p1",
        handle: "greeting-bot",
        name: "Greeting Bot",
        version: 3,
        versionId: "ver_abc123",
        commitMessage: "Updated tone",
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "You are a friendly bot." }],
        prompt: "You are a friendly bot.",
        temperature: 0.7,
        maxTokens: 512,
        responseFormat: { type: "json_object" },
        parameters: { reasoning_effort: "low" },
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
        tags: [
          { name: "production", versionId: "ver_abc123" },
          { name: "latest", versionId: "ver_abc123" },
        ],
      };

      const mutation: PromptMutationResponse = {
        id: "p1",
        handle: "greeting-bot",
        name: "Greeting Bot",
        latestVersionNumber: 4,
        versionId: "ver_def456",
        tags: ["production"],
      };

      expect(detail.versionId).toBe("ver_abc123");
      expect(detail.tags?.[0]?.versionId).toBe("ver_abc123");
      expect(mutation.versionId).toBe("ver_def456");
    });
  });
});
