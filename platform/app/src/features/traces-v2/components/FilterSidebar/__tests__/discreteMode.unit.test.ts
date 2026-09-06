import { describe, expect, it } from "vitest";
import {
  computeDiscreteEligible,
  resolveNumericModeByKey,
} from "../discreteMode";
import type { RangeSectionData } from "../types";

/**
 * `discreteMode` factors two pure helpers out of `useFilterSidebarData`:
 *
 *   • `computeDiscreteEligible({ ranges, maxDistinctValues })` picks the
 *     range descriptors that carry a bounded `discrete` payload — a small
 *     enough distinct-value set to render as a tick-list rather than the
 *     min/max slider.
 *   • `resolveNumericModeByKey({ discreteEligible, numericModes })` folds
 *     the per-project override on top: `override ?? "discrete"` for every
 *     eligible key. Non-eligible keys never enter the map (the section
 *     stays a slider regardless of override).
 */

const range = (
  partial: Partial<RangeSectionData> & { key: string },
): RangeSectionData => ({
  kind: "range",
  group: "trace",
  label: partial.key,
  min: 0,
  max: 100,
  ...partial,
});

const discrete = (
  values: number[],
  distinctCountOverride?: number,
): RangeSectionData["discrete"] => ({
  values: values.map((v) => ({ value: v, count: 1 })),
  distinctCount: distinctCountOverride ?? values.length,
});

describe("computeDiscreteEligible", () => {
  describe("given ranges with no discrete payload", () => {
    it("returns an empty map (slider-only)", () => {
      const ranges = [range({ key: "duration_ms" }), range({ key: "tokens" })];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect(result.size).toBe(0);
    });
  });

  describe("given a range with discrete distinctCount within the cap", () => {
    it("includes the range, keyed by `key`", () => {
      const ranges = [
        range({
          key: "version",
          discrete: discrete([1, 2, 3]),
        }),
      ];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect(result.size).toBe(1);
      expect(result.get("version")).toBeDefined();
    });
  });

  describe("given a range with discrete distinctCount EQUAL to the cap", () => {
    it("includes it — the cap is inclusive", () => {
      const ranges = [
        range({
          key: "version",
          discrete: discrete([1, 2, 3, 4, 5, 6, 7, 8]),
        }),
      ];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect(result.has("version")).toBe(true);
    });
  });

  describe("given a range with distinctCount above the cap", () => {
    it("excludes it (high-cardinality stays a slider)", () => {
      const ranges = [
        range({
          key: "duration_ms",
          discrete: discrete([1, 2, 3], 999),
        }),
      ];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect(result.has("duration_ms")).toBe(false);
    });
  });

  describe("given a range with an empty discrete.values list", () => {
    it("excludes it — nothing to render as ticks", () => {
      const ranges = [
        range({
          key: "version",
          discrete: { values: [], distinctCount: 0 },
        }),
      ];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect(result.has("version")).toBe(false);
    });
  });

  describe("given a mix of eligible and ineligible ranges", () => {
    it("returns only the eligible subset, preserving keys", () => {
      const ranges = [
        range({ key: "duration_ms" }),
        range({ key: "version", discrete: discrete([1, 2, 3]) }),
        range({
          key: "high_card",
          discrete: discrete([1], 9999),
        }),
        range({ key: "retry", discrete: discrete([0, 1, 2]) }),
      ];
      const result = computeDiscreteEligible({ ranges, maxDistinctValues: 8 });
      expect([...result.keys()].sort()).toEqual(["retry", "version"]);
    });
  });
});

describe("resolveNumericModeByKey", () => {
  const eligibleMap = new Map([
    ["version", range({ key: "version", discrete: discrete([1, 2, 3]) })],
    ["retry", range({ key: "retry", discrete: discrete([0, 1, 2]) })],
  ]);

  describe("given an eligible key with no user override", () => {
    it("defaults to discrete", () => {
      const result = resolveNumericModeByKey({
        discreteEligible: eligibleMap,
        numericModes: {},
      });
      expect(result.get("version")).toBe("discrete");
      expect(result.get("retry")).toBe("discrete");
    });
  });

  describe("given an eligible key with a user override of `range`", () => {
    it("respects the override", () => {
      const result = resolveNumericModeByKey({
        discreteEligible: eligibleMap,
        numericModes: { version: "range" },
      });
      expect(result.get("version")).toBe("range");
      expect(result.get("retry")).toBe("discrete");
    });
  });

  describe("given a user override for a NON-eligible key", () => {
    it("does not introduce a new entry — only eligible keys are present", () => {
      const result = resolveNumericModeByKey({
        discreteEligible: eligibleMap,
        numericModes: { duration_ms: "discrete" },
      });
      expect(result.has("duration_ms")).toBe(false);
      expect(result.size).toBe(2);
    });
  });

  describe("given an empty eligibility map", () => {
    it("returns an empty map regardless of overrides", () => {
      const result = resolveNumericModeByKey({
        discreteEligible: new Map(),
        numericModes: { version: "range", retry: "discrete" },
      });
      expect(result.size).toBe(0);
    });
  });
});
