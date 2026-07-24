import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRelativeDate } from "../utils/date-parsing.js";

describe("parseRelativeDate()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when given a relative duration", () => {
    it("parses hours", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const result = parseRelativeDate("24h");

      expect(result).toBe(now - 24 * 3600000);
    });

    it("parses days", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const result = parseRelativeDate("7d");

      expect(result).toBe(now - 7 * 86400000);
    });

    it("parses weeks", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const result = parseRelativeDate("2w");

      expect(result).toBe(now - 2 * 604800000);
    });

    it("parses months", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const result = parseRelativeDate("3m");

      expect(result).toBe(now - 3 * 2592000000);
    });
  });

  describe("when given an ISO date string", () => {
    it("parses a valid ISO date", () => {
      const result = parseRelativeDate("2024-06-15T12:00:00Z");

      expect(result).toBe(Date.parse("2024-06-15T12:00:00Z"));
    });

    it("parses a date-only string", () => {
      const result = parseRelativeDate("2024-06-15");

      expect(result).toBe(Date.parse("2024-06-15"));
    });
  });

  describe("when given an invalid string", () => {
    it("throws an error for garbage input", () => {
      expect(() => parseRelativeDate("banana")).toThrow(
        'Invalid date: "banana"'
      );
    });

    it("throws an error for empty string", () => {
      expect(() => parseRelativeDate("")).toThrow('Invalid date: ""');
    });

    it("includes usage hint in error message", () => {
      expect(() => parseRelativeDate("xyz")).toThrow(
        "relative duration"
      );
    });
  });
});
