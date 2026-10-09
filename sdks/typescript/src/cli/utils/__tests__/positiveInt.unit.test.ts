import { describe, it, expect } from "vitest";
import { parsePositiveIntOrNull } from "../positiveInt";

describe("parsePositiveIntOrNull", () => {
  describe("given a whole positive number", () => {
    it("returns it", () => {
      expect(parsePositiveIntOrNull("3")).toBe(3);
      expect(parsePositiveIntOrNull(" 42 ")).toBe(42);
    });
  });

  describe("given a value with characters the number does not cover", () => {
    it("refuses instead of reading the leading digits", () => {
      // parseInt("1abc", 10) is 1, which is how a bad version string used to
      // become a save against version 1.
      expect(parsePositiveIntOrNull("1abc")).toBeNull();
      expect(parsePositiveIntOrNull("latest")).toBeNull();
      expect(parsePositiveIntOrNull("")).toBeNull();
      expect(parsePositiveIntOrNull("  ")).toBeNull();
    });
  });

  describe("given a fractional value", () => {
    it("refuses instead of truncating it", () => {
      expect(parsePositiveIntOrNull("1.5")).toBeNull();
    });
  });

  describe("given zero or a negative number", () => {
    it("refuses", () => {
      expect(parsePositiveIntOrNull("0")).toBeNull();
      expect(parsePositiveIntOrNull("-2")).toBeNull();
    });
  });

  describe("given a number past the safe integer range", () => {
    it("refuses", () => {
      expect(parsePositiveIntOrNull("9007199254740993")).toBeNull();
      expect(parsePositiveIntOrNull("Infinity")).toBeNull();
    });
  });
});
