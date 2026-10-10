/**
 * The hidden feedback directive Langy may emit in a reply.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { parseLangyFeedbackDirective } from "../langy-feedback-directive.ts";

describe("parseLangyFeedbackDirective", () => {
  describe("given a reply carrying a frustrated directive", () => {
    /** @scenario "Langy asks for feedback at a high-signal moment via a hidden directive" */
    it("strips the directive text and asks, tailored to a rough moment", () => {
      const parsed = parseLangyFeedbackDirective("Sorry about that. [langy:feedback:frustrated]");

      expect(parsed).toEqual({
        requested: true,
        sentiment: "frustrated",
        cleanedText: "Sorry about that.",
      });
    });
  });

  describe("given a reply with no directive", () => {
    it("does not ask and leaves the text alone", () => {
      const parsed = parseLangyFeedbackDirective("All done.");

      expect(parsed).toEqual({ requested: false, sentiment: undefined, cleanedText: "All done." });
    });
  });
});
