/**
 * The refusals `/api/prompts` answers, at the statuses main published: the
 * system-prompt pair keeps its own 400/409, and a tag or address refusal is a 422.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  PromptTagInvalidError,
  SystemPromptConflictError,
  SystemPromptRequiredError,
  type PromptApi,
} from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import type { PromptService } from "../../services/prompt.service.ts";
import { buildPromptApp, mountPromptRest } from "./prompt-rest.harness.ts";

function updateRefusedWith(error: Error) {
  const app = buildPromptApp(
    createApiFixture<PromptService>({
      updatePrompt: async () => {
        throw error;
      },
    }),
  );

  return mountPromptRest({ app }).request("/api/prompts/checkout-agent", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitMessage: "tighten", prompt: "Be brief." }),
  });
}

function getPrompt(
  path: string,
  app: PromptApi = buildPromptApp(createApiFixture<PromptService>()),
) {
  return mountPromptRest({ app }).request(path);
}

describe("the /api/prompts refusals", () => {
  describe("when an update is refused for a missing system prompt (Issue #3196)", () => {
    /** @scenario "Toast on server-side validation failure shows a friendly message" */
    it("answers 400 with the refusal's own code and friendly message", async () => {
      const refusal = new SystemPromptRequiredError();

      const response = await updateRefusedWith(refusal);
      const body = (await response.json()) as { error: string; message: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe("prompt_system_prompt_required");
      expect(body.message).toBe(refusal.message);
      expect(body.message).not.toMatch(/SystemPrompt(Required|Conflict)Error/);
    });
  });

  describe("when an update sets both a prompt and a system message", () => {
    it("answers 409 with the conflict's own code", async () => {
      const response = await updateRefusedWith(new SystemPromptConflictError());
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe("prompt_system_prompt_conflict");
    });
  });

  describe("when a read names a tag the catalogue refuses", () => {
    it("answers 422 with the tag refusal's code", async () => {
      const app = buildPromptApp(
        createApiFixture<PromptService>({
          getPromptByIdOrHandle: async () => {
            throw new PromptTagInvalidError("Invalid tag name.");
          },
        }),
      );

      const response = await getPrompt("/api/prompts/checkout-agent:nightly", app);
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(422);
      expect(body.error).toBe("prompt_tag_invalid");
    });
  });

  describe("when a shorthand address also names a tag by query", () => {
    it("answers 422 as a validation error", async () => {
      const response = await getPrompt("/api/prompts/checkout-agent:production?tag=staging");
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(422);
      expect(body.error).toBe("validation_error");
    });
  });
});
