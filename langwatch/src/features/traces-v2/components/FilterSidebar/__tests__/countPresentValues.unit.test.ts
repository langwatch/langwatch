import { describe, expect, it } from "vitest";
import { countPresentValues } from "../utils";

/**
 * A categorical facet keeps its default-value scaffolding visible even when a
 * value has zero matching traces (STATUS always lists OK / Error / Warning so
 * any of them is one click away to filter on). The section header's value-count
 * badge, however, should report how many values are actually *present* in the
 * data — so it tallies only `count > 0`. These tests pin that rule so the badge
 * can't drift back to counting the empty default rows.
 */
describe("countPresentValues", () => {
  describe("when some default values have zero matching traces", () => {
    it("counts only the values with at least one matching trace", () => {
      // The canonical STATUS case: OK has traces, Error / Warning are seeded
      // defaults sitting at zero. The badge should read 1, not 3.
      const items = [
        { value: "ok", count: 114 },
        { value: "error", count: 0 },
        { value: "warning", count: 0 },
      ];

      expect(countPresentValues(items)).toBe(1);
    });
  });

  describe("when every value has matching traces", () => {
    it("counts all of them", () => {
      const items = [
        { value: "application", count: 40 },
        { value: "evaluation", count: 12 },
      ];

      expect(countPresentValues(items)).toBe(2);
    });
  });

  describe("when no value has matching traces", () => {
    it("counts zero (the badge then hides entirely)", () => {
      const items = [
        { value: "ok", count: 0 },
        { value: "error", count: 0 },
      ];

      expect(countPresentValues(items)).toBe(0);
    });
  });

  describe("when the list is empty", () => {
    it("counts zero", () => {
      expect(countPresentValues([])).toBe(0);
    });
  });
});
