import { describe, expect, it } from "vitest";

import { textContainsPromptLineAligned } from "../freshTurnPresence";

describe("textContainsPromptLineAligned", () => {
  describe("given the prompt survived as its own line", () => {
    it("matches at text start, mid-text, and text end", () => {
      expect(textContainsPromptLineAligned("continue", "continue")).toBe(true);
      expect(
        textContainsPromptLineAligned(
          "<reminder>x</reminder>\ncontinue",
          "continue",
        ),
      ).toBe(true);
      expect(
        textContainsPromptLineAligned("continue\n[tool_result...]", "continue"),
      ).toBe(true);
    });

    it("matches a multi-line prompt block", () => {
      const prompt = "fix the bug\nthen run the tests";
      expect(
        textContainsPromptLineAligned(`prefix\n${prompt}\nsuffix`, prompt),
      ).toBe(true);
    });
  });

  describe("given the prompt only appears inside other prose", () => {
    // The regression this predicate exists for: a bare `includes` judged a
    // short prompt ("ok", "continue") as already present because it occurred
    // inside a recovered file dump, so the fresh turn was never reinstated.
    it("does not match a mid-line substring", () => {
      expect(
        textContainsPromptLineAligned(
          "the loop will continue until done",
          "continue",
        ),
      ).toBe(false);
      expect(textContainsPromptLineAligned("look ok?", "ok")).toBe(false);
    });
  });

  describe("given the surviving line is padded with whitespace", () => {
    // Regression: the needle is trimmed but the recovered line may be indented
    // or trailing-padded. Requiring a bare `\n` boundary made a genuinely
    // present-but-padded prompt read as absent, so it got appended twice.
    it("matches an indented occurrence", () => {
      expect(
        textContainsPromptLineAligned(
          "prefix\n    continue\nsuffix",
          "continue",
        ),
      ).toBe(true);
    });

    it("matches a trailing-padded occurrence (incl. CRLF)", () => {
      expect(
        textContainsPromptLineAligned("continue   \nnext", "continue"),
      ).toBe(true);
      expect(
        textContainsPromptLineAligned("continue\r\nnext", "continue"),
      ).toBe(true);
    });

    it("matches when the whole text is just the padded prompt", () => {
      expect(textContainsPromptLineAligned("   continue   ", "continue")).toBe(
        true,
      );
    });

    it("still rejects a mid-line substring even with surrounding whitespace", () => {
      // Non-whitespace on the same line means it's embedded, not its own turn.
      expect(
        textContainsPromptLineAligned("  the loop will continue  ", "continue"),
      ).toBe(false);
    });
  });

  describe("given an empty or whitespace prompt", () => {
    it("never matches", () => {
      expect(textContainsPromptLineAligned("anything", "")).toBe(false);
      expect(textContainsPromptLineAligned("anything", "   ")).toBe(false);
    });
  });
});
