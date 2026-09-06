import { describe, expect, it } from "vitest";
import { parseSeriesIndex } from "../seriesName";

describe("parseSeriesIndex", () => {
  describe("given a well-formed seriesName", () => {
    it("reads the leading index", () => {
      expect(parseSeriesIndex("1/evaluations.evaluation_score/avg")).toBe(1);
    });

    it("reads a multi-digit index", () => {
      expect(parseSeriesIndex("12/metadata.trace_id/cardinality")).toBe(12);
    });

    it("reads index zero", () => {
      expect(parseSeriesIndex("0/metadata.trace_id/cardinality")).toBe(0);
    });
  });

  describe("given no seriesName", () => {
    // The legacy cron defaults a missing seriesName to the first series.
    it("defaults to the first series for undefined", () => {
      expect(parseSeriesIndex(undefined)).toBe(0);
    });

    it("defaults to the first series for an empty string", () => {
      expect(parseSeriesIndex("")).toBe(0);
    });
  });

  describe("given a malformed seriesName", () => {
    // NaN is propagated rather than coerced so callers bounds-check and skip,
    // instead of silently reading series[0] for a trigger that names series 3.
    it("returns NaN for a non-numeric index", () => {
      expect(parseSeriesIndex("abc/metadata.trace_id/cardinality")).toBeNaN();
    });

    it("returns a negative number for a negative index", () => {
      expect(parseSeriesIndex("-1/metadata.trace_id/cardinality")).toBe(-1);
    });
  });
});
