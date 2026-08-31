import { describe, expect, it } from "vitest";
import type {
  PromptDetailResponse,
  PromptMutationResponse,
} from "../langwatch-api.js";

describe("Prompt response type interfaces", () => {
  describe("given fully-populated PromptDetailResponse and PromptMutationResponse fixtures", () => {
    /** @scenario Declaring every rendered field on the typed response interfaces */
    it("declares every field the prompt tools render, with no `as` cast needed", () => {
      const detail: PromptDetailResponse = {
        id: "p1",
        handle: "greeting-bot",
        name: "Greeting Bot",
        latestVersionNumber: 3,
        version: 3,
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "You are a friendly bot." }],
        prompt: [{ role: "system", content: "You are a friendly bot." }],
        versions: [
          {
            versionId: "ver_abc123",
            version: 3,
            commitMessage: "Updated tone",
            model: "openai/gpt-4o",
            messages: [
              { role: "system", content: "You are a friendly bot." },
            ],
            temperature: 0.7,
            maxTokens: 512,
            responseFormat: { type: "json_object" },
            parameters: [{ identifier: "temperature", type: "number" }],
            inputs: [{ identifier: "question", type: "str" }],
            outputs: [{ identifier: "answer", type: "str" }],
            tags: ["production", "latest"],
          },
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

      expect(detail.versions?.[0]?.versionId).toBe("ver_abc123");
      expect(mutation.versionId).toBe("ver_def456");
    });
  });
});
