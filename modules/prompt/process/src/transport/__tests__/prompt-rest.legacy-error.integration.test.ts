import { errorSchema, NotFoundError } from "@langwatch/api/rest";
import { PromptTagValidationError } from "@langwatch/prompt-contract";
/**
 * The prompts family publishes main's flat `{ error, message? }` refusal body, so its refusals
 * also carry main's root `error` beside the canonical envelope (Alex, 2026-10-06, night).
 * Spec: packages/api/specs/transport-conventions.feature.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { PromptService } from "../../services/prompt.service.ts";
import { buildPromptApp, mountPromptRest } from "./prompt-rest.harness.ts";

async function answerOf(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("the /api/prompts refusals, as released clients parse them", () => {
  describe("when an update names a tag the organization never defined", () => {
    /** @scenario "A handled refusal at a status published flat carries its code as the root error" */
    it("answers 422 with the handled code as the root error and the envelope beside it", async () => {
      const app = buildPromptApp(
        createApiFixture<PromptService>({
          updatePrompt: async () => {
            throw new PromptTagValidationError(
              'Tag "nightly" is not defined for this organization',
            );
          },
        }),
      );

      const { status, body } = await answerOf(
        await mountPromptRest({ app }).request("/api/prompts/checkout-agent", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commitMessage: "tag it", tags: ["nightly"] }),
        }),
      );

      expect(status).toBe(422);
      expect(body).toMatchObject({
        error: "prompt_tag_invalid",
        type: "unprocessable_entity",
        code: "prompt_tag_invalid",
        retryable: false,
      });
      expect(errorSchema.validate(body)).toBe(true);
    });
  });

  describe("when a read is refused with a sentence error", () => {
    /** @scenario "A sentence refusal at a status published flat carries its sentence as the root error" */
    it("answers 404 with the sentence as the root error and the envelope beside it", async () => {
      const app = buildPromptApp(
        createApiFixture<PromptService>({
          getPromptByIdOrHandle: async () => {
            throw new NotFoundError("Prompt config not found.");
          },
        }),
      );

      const { status, body } = await answerOf(
        await mountPromptRest({ app }).request("/api/prompts/checkout-agent"),
      );

      expect(status).toBe(404);
      expect(body).toMatchObject({ error: "Prompt config not found.", code: "not_found" });
      expect(errorSchema.validate(body)).toBe(true);
    });
  });
});
