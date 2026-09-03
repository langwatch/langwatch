/**
 * The link and the name a shared folder is handed.
 *
 * @see specs/langy/langy-local-control.feature
 */

import { describe, expect, it } from "vitest";
import { conversationTitle, conversationUrl } from "../session.core";

describe("conversationUrl", () => {
  describe("when the platform knows its own origin", () => {
    it("builds a link the terminal can open", () => {
      expect(conversationUrl("conv_1", "https://app.langwatch.ai")).toBe(
        "https://app.langwatch.ai/?langyConversation=conv_1",
      );
    });

    it("ignores a trailing slash on the origin", () => {
      expect(conversationUrl("conv_1", "http://localhost:5570/")).toBe(
        "http://localhost:5570/?langyConversation=conv_1",
      );
    });

    it("escapes the conversation id", () => {
      expect(conversationUrl("a b", "https://app.langwatch.ai")).toBe(
        "https://app.langwatch.ai/?langyConversation=a%20b",
      );
    });
  });

  describe("when the origin is missing or has no scheme", () => {
    it("returns the path rather than a guessed origin", () => {
      expect(conversationUrl("conv_1", "")).toBe("/?langyConversation=conv_1");
      expect(conversationUrl("conv_1", "localhost:5570")).toBe(
        "/?langyConversation=conv_1",
      );
    });
  });
});

describe("conversationTitle", () => {
  describe("when Langy already named the conversation", () => {
    it("uses the name as it is", () => {
      expect(conversationTitle("Instrument tracing")).toBe(
        "Instrument tracing",
      );
    });
  });

  describe("when the conversation has no name yet", () => {
    it("calls it Langy", () => {
      expect(conversationTitle(null)).toBe("Langy");
      expect(conversationTitle("   ")).toBe("Langy");
    });

    it("cuts the first message back to a whole word", () => {
      const placeholder =
        "Please add a health endpoint to the support service and " +
        "write a test for it";
      const short = conversationTitle(placeholder);

      expect(short).toBe(
        "Please add a health endpoint to the support service and\u2026",
      );
      expect(short.length).toBeLessThanOrEqual(60);
      expect(placeholder.startsWith(short.slice(0, -1))).toBe(true);
    });

    it("leaves no space or punctuation before the ellipsis", () => {
      expect(conversationTitle(`${"word ".repeat(20)}end`)).not.toMatch(
        /[\s.,;:!?-]\u2026$/,
      );
    });

    it("cuts a name with no spaces at the limit", () => {
      expect(conversationTitle("x".repeat(80))).toBe(
        `${"x".repeat(60)}\u2026`,
      );
    });
  });
});
