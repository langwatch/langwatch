import { describe, expect, it } from "vitest";
import { parseEditedValue } from "../rangeControls";

describe("parseEditedValue", () => {
  describe("given a formatted label with a unit suffix", () => {
    it.each([
      ["1.5s", 1.5],
      ["100ms", 100],
      ["1.5kg", 1.5],
    ])("strips the suffix and parses `%s` to %s", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("given a formatted label with a currency prefix", () => {
    it("strips `$` and parses the remainder", () => {
      expect(parseEditedValue("$0.05")).toBe(0.05);
    });
  });

  describe("given a formatted label with thousand separators", () => {
    it("strips `,` and parses the remainder", () => {
      expect(parseEditedValue("12,300")).toBe(12_300);
    });
  });

  describe("given surrounding whitespace", () => {
    it("trims and parses the inner number", () => {
      expect(parseEditedValue("  42  ")).toBe(42);
    });
  });

  describe("given scientific notation", () => {
    it.each([
      ["1e6", 1_000_000],
      ["2.5E-3", 0.0025],
      ["1.5e2", 150],
      ["1E10", 1e10],
    ])("parses `%s` to %s — `e/E` is preserved through the strip", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("given a plain number", () => {
    it.each([
      ["0", 0],
      ["-5", -5],
      ["3.14159", 3.14159],
      ["1000000", 1_000_000],
    ])("parses `%s` to %s", (input, expected) => {
      expect(parseEditedValue(input)).toBe(expected);
    });
  });

  describe("given input that strips to an empty string", () => {
    it.each([
      ["", "empty input"],
      ["   ", "whitespace only"],
      ["abc", "letters only"],
      ["$,kg", "punctuation and units only"],
    ])("returns null when `%s` (%s)", (input) => {
      expect(parseEditedValue(input)).toBeNull();
    });
  });

  describe("given hex notation", () => {
    it("strips `xF` letters and resolves `0xFF` to 0 — hex is NOT supported", () => {
      // Documented limitation: only `e/E` are preserved through the
      // strip, so `0xFF` becomes `0`.
      expect(parseEditedValue("0xFF")).toBe(0);
    });
  });

  describe("given a number with both unit suffix and thousand separators", () => {
    it("strips both and parses the remainder", () => {
      expect(parseEditedValue("1,234.5kg")).toBe(1234.5);
    });
  });

  describe("given scientific notation followed by a stray unit letter", () => {
    it("strips the unit letter and preserves the sci-notation digits", () => {
      expect(parseEditedValue("1.5e2x")).toBe(150);
    });
  });

  describe("given the literal `Infinity`", () => {
    it("returns null — letters strip to empty", () => {
      // `Infinity` → strip removes I/n/f/i/n/i/t/y → empty → null. Even
      // if it survived, `Number.isFinite(Infinity)` is false, so the
      // function would still reject it.
      expect(parseEditedValue("Infinity")).toBeNull();
    });
  });

  describe("given the literal `NaN`", () => {
    it("returns null — letters strip to empty", () => {
      expect(parseEditedValue("NaN")).toBeNull();
    });
  });
});
