import { describe, expect, it } from "vitest";
import { isTextLikelyOverflowing } from "../src/text-overflow";

describe("isTextLikelyOverflowing", () => {
  /** @scenario Collapsed virtualized cells expand only beyond the configured limit */
  it("treats the threshold itself as fitting", () => {
    expect(isTextLikelyOverflowing("a".repeat(500))).toBe(false);
    expect(isTextLikelyOverflowing("a".repeat(501))).toBe(true);
  });

  /** @scenario Line breaks account for their rendered line height without DOM measurement */
  it("adds the configured line cost for every newline", () => {
    expect(isTextLikelyOverflowing("abc\ndef", 68, 62)).toBe(true);
    expect(isTextLikelyOverflowing("abc\ndef", 69, 62)).toBe(false);
  });
});
