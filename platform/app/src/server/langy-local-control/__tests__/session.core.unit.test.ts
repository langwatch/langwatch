/**
 * The link a shared folder is handed.
 *
 * @see specs/langy/langy-local-control.feature
 */

import { describe, expect, it } from "vitest";
import { conversationUrl } from "../session.core";

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
