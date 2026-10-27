/** @see specs/langy/langy-model-selection.feature */
import { describe, expect, it } from "vitest";

import {
  langyContinueConversationInputSchema,
  langyPanelCreateConversationInputSchema,
} from "../langy-trpc.schemas.ts";

const turn = (modelOverride: string) => ({
  projectId: "project-1",
  conversationId: "conversation-1",
  messages: [{ role: "user" as const, parts: [{ type: "text", text: "hello" }] }],
  modelOverride,
});

const turnSchemas = [
  ["create", langyPanelCreateConversationInputSchema],
  ["continue", langyContinueConversationInputSchema],
] as const;

describe.each(turnSchemas)("the %s turn input", (_name, schema) => {
  describe("when the model id itself contains a slash", () => {
    /** @scenario "A model id that itself contains a slash is accepted" */
    it("accepts the full id and hands it on unchanged", () => {
      const parsed = schema.safeParse(turn("custom/stealth/ox-alpha"));

      expect(parsed.success).toBe(true);
      expect(parsed.data?.modelOverride).toBe("custom/stealth/ox-alpha");
    });
  });

  describe("when a named provider row id stands in front of the model", () => {
    /** @scenario "A model from a named provider row is accepted with the row id in front" */
    it("accepts the two-slash reference and hands it on unchanged", () => {
      const reference = "mp_row123/openrouter/stealth/ox-alpha";

      const parsed = schema.safeParse(turn(reference));

      expect(parsed.success).toBe(true);
      expect(parsed.data?.modelOverride).toBe(reference);
    });
  });

  describe("when the reference has no provider segment", () => {
    /** @scenario "A model reference without a provider segment is rejected as invalid input" */
    it("rejects the input on the model field", () => {
      const parsed = schema.safeParse(turn("gpt-5-mini"));

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([["modelOverride"]]);
    });
  });

  describe("when the reference has an empty segment", () => {
    /** @scenario "A model reference with an empty segment is rejected as invalid input" */
    it("rejects the input on the model field, so no turn reaches the handler", () => {
      const parsed = schema.safeParse(turn("custom//stealth"));

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([["modelOverride"]]);
    });
  });
});
