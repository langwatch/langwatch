import { describe, expect, it } from "vitest";
import { firstGrapheme } from "../firstGrapheme";

describe("firstGrapheme", () => {
  describe("given a name beginning with an astral emoji", () => {
    /** @scenario "an emoji outside the basic plane survives being taken as an initial" */
    it("returns the whole emoji rather than a lone surrogate", () => {
      const initial = firstGrapheme("🚩 Langy");

      expect(initial).toBe("🚩");
      // The bug this pins: "🚩".charAt(0) is a lone high surrogate, which the
      // browser paints as a replacement box. Asserting on the length as well
      // as the value means a fix that returns "\uD83D" alone cannot pass by
      // looking similar in a diff.
      expect(initial).toHaveLength(2);
      expect(isLoneSurrogate(initial)).toBe(false);
    });
  });

  describe("given a name beginning with a multi-code-point sequence", () => {
    /** @scenario "a character built from several code points is kept together" */
    it("keeps the sequence together, because a reader sees one character", () => {
      expect(firstGrapheme("🇳🇱 Netherlands")).toBe("🇳🇱");
      expect(firstGrapheme("👨‍👩‍👧 Family project")).toBe("👨‍👩‍👧");
    });
  });

  describe("given an ordinary name", () => {
    /** @scenario "an ordinary name is unaffected" */
    it("returns the same letter it always did", () => {
      expect(firstGrapheme("Engineering")).toBe("E");
      expect(firstGrapheme("Engineering")).toBe("Engineering".slice(0, 1));
    });
  });

  describe("given a name that starts with whitespace", () => {
    /** @scenario "leading whitespace is not the initial" */
    it("returns the first character that is not whitespace", () => {
      expect(firstGrapheme("  Doc Chat")).toBe("D");
    });
  });

  describe("given an empty name", () => {
    it("returns an empty string rather than throwing", () => {
      expect(firstGrapheme("")).toBe("");
      expect(firstGrapheme("   ")).toBe("");
    });
  });
});

function isLoneSurrogate(value: string): boolean {
  const first = value.charCodeAt(0);
  const isHighSurrogate = first >= 0xd800 && first <= 0xdbff;
  if (!isHighSurrogate) return false;
  const second = value.charCodeAt(1);
  return !(second >= 0xdc00 && second <= 0xdfff);
}
