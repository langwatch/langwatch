import { describe, expect, it } from "vitest";
import { dateInputToISO } from "../BackofficeTable";

/**
 * Regression — CodeRabbit review on #3254 surfaced that
 * `new Date("2026-04-16").toISOString()` parses as UTC midnight, which shifts
 * the calendar day one step backwards for users west of UTC (the date they
 * typed ends up stored as the previous day). `dateInputToISO` must preserve
 * the typed calendar date in every timezone.
 */
describe("dateInputToISO", () => {
  describe("when given a YYYY-MM-DD date-input value", () => {
    it("preserves the typed calendar day regardless of timezone", () => {
      const iso = dateInputToISO("2026-04-16");
      // Must be some instant within 2026-04-16 local time — parsing the
      // result into any Date and reading getFullYear/Month/Date locally must
      // round-trip the original.
      const d = new Date(iso!);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(3); // April (0-indexed)
      expect(d.getDate()).toBe(16);
    });

    it("does not drift on month boundaries", () => {
      const first = dateInputToISO("2026-05-01");
      const firstDate = new Date(first!);
      expect(firstDate.getMonth()).toBe(4);
      expect(firstDate.getDate()).toBe(1);
    });
  });

  describe("when given an empty or malformed value", () => {
    it("returns null for empty string", () => {
      expect(dateInputToISO("")).toBeNull();
    });

    it("returns null for non-date strings", () => {
      expect(dateInputToISO("not-a-date")).toBeNull();
      expect(dateInputToISO("2026/04/16")).toBeNull();
    });
  });
});
