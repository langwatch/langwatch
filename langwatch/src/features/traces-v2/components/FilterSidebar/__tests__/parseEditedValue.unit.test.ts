import { describe, expect, it } from "vitest";
import { parseEditedValue } from "../RangeSection";

describe("parseEditedValue", () => {
  describe("happy path — formatted labels round-trip", () => {
    it.each([
      ["1.5s", 1.5],
      ["$0.05", 0.05],
      ["12,300", 12_300],
      ["100ms", 100],
      ["1.5kg", 1.5],
      ["  42  ", 42],
    ])("`%s` parses to %s", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("scientific notation", () => {
    it.each([
      ["1e6", 1_000_000],
      ["2.5E-3", 0.0025],
      ["1.5e2", 150],
      ["1E10", 1e10],
    ])("`%s` parses to %s", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("plain numbers", () => {
    it.each([
      ["0", 0],
      ["-5", -5],
      ["3.14159", 3.14159],
      ["1000000", 1_000_000],
    ])("`%s` parses to %s", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("returns null for unparseable input", () => {
    it.each([
      ["", "empty string"],
      ["   ", "whitespace only"],
      ["abc", "letters only — strip leaves empty"],
      ["$,kg", "punctuation/units only — strip leaves empty"],
    ])("`%s` returns null (%s)", (input) => {
      expect(parseEditedValue(input)).toBeNull();
    });
  });

  describe("known opinionated edges (pinned to surface regressions)", () => {
    it("`0xFF` strips the `xF` letters → `0` (does NOT parse hex)", () => {
      // Opinionated: hex notation isn't supported. The strip removes
      // `x`, `F`, and the second `F` (only `e/E` are preserved), so
      // `0xFF` becomes `0`. Documented limitation.
      expect(parseEditedValue("0xFF")).toBe(0);
    });

    it("`1,234.5kg` resolves to 1234.5 — comma-stripping plus unit-stripping", () => {
      expect(parseEditedValue("1,234.5kg")).toBe(1234.5);
    });

    it("`1.5e2x` resolves to 150 — `x` is stripped, `e` preserved", () => {
      expect(parseEditedValue("1.5e2x")).toBe(150);
    });

    it("`Infinity` is NOT preserved — `I/n/f/y` are stripped, the literal can't survive", () => {
      // `Infinity` → strip removes I/n/f/i/n/i/t/y → empty → null.
      // (NB: even if it survived, `Number.isFinite(Infinity)` is false
      // so it would still return null — defence-in-depth.)
      expect(parseEditedValue("Infinity")).toBeNull();
    });

    it("`NaN` is NOT preserved — strip leaves empty (and Number.isFinite would reject it anyway)", () => {
      expect(parseEditedValue("NaN")).toBeNull();
    });
  });
});
