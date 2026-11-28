/**
 * A provider content filter refusal must send the reader to the provider's filter, never to the
 * Fast model settings, which work.
 */
import { explainSerializedError } from "@langwatch/handled-error/presentation";
import { AiContentFilteredError } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

describe("the copy a content filter refusal renders", () => {
  describe("when translation is refused by the provider's content filter", () => {
    /** @scenario "A content filter refusal says the provider filtered the text, not that the model is misconfigured" */
    it("names the content filter and never the model configuration", () => {
      const refusal = new AiContentFilteredError({
        featureKey: "translate.text",
        role: "FAST",
        featureDisplayName: "Inline translation",
      });

      const { title, description } = explainSerializedError(refusal.serialize());
      const copy = `${title} ${description}`;

      expect(copy).toMatch(/content filter/i);
      expect(copy).not.toMatch(/fast model|model configuration/i);
    });
  });
});
