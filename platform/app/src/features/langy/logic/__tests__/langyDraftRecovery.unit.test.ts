/**
 * A failed send gives back the reader's words, and only theirs.
 *
 * @see specs/langy/langy-composer-feedback-and-cards.feature
 */
import { describe, expect, it } from "vitest";

import { langyDraftToRestore } from "../langyDraftRecovery";

describe("langyDraftToRestore", () => {
  describe("given a send the reader typed", () => {
    /** @scenario "A failed send gives back only what the customer typed" */
    it("hands the words back to an empty field", () => {
      expect(
        langyDraftToRestore({ sentText: "instrument my traces", draft: "" }),
      ).toBe("instrument my traces");
    });
  });

  describe("given the panel sent the message itself", () => {
    /** @scenario "A failed send gives back only what the customer typed" */
    it("hands back nothing, because nobody typed it", () => {
      expect(langyDraftToRestore({ sentText: null, draft: "" })).toBeNull();
    });
  });

  describe("given the reader has started typing something else", () => {
    /** @scenario "A failed send gives back only what the customer typed" */
    it("leaves what they are writing alone", () => {
      expect(
        langyDraftToRestore({ sentText: "the old one", draft: "a new one" }),
      ).toBeNull();
    });

    it("treats a field of whitespace as empty", () => {
      expect(
        langyDraftToRestore({ sentText: "the old one", draft: "   " }),
      ).toBe("the old one");
    });
  });
});
