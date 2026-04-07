import { describe, expect, it } from "vitest";
import { filterOutEmptyFilters } from "../utils";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "~/server/filters/types";

describe("filterOutEmptyFilters()", () => {
  describe("when filters is undefined", () => {
    it("returns empty object", () => {
      expect(filterOutEmptyFilters(undefined)).toEqual({});
    });
  });

  describe("when filter is a flat string array", () => {
    it("keeps non-empty arrays", () => {
      const filters = {
        "spans.model": ["gpt-4"],
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({
        "spans.model": ["gpt-4"],
      });
    });

    it("strips empty arrays", () => {
      const filters = {
        "spans.model": [],
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({});
    });
  });

  describe("when filter is a nested object with leaf arrays", () => {
    it("keeps objects with non-empty leaf arrays", () => {
      const filters = {
        "evaluations.passed": { "eval-1": ["true"] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({
        "evaluations.passed": { "eval-1": ["true"] },
      });
    });

    it("strips objects where all leaf arrays are empty", () => {
      const filters = {
        "evaluations.passed": { "eval-1": [] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({});
    });

    it("strips objects with multiple empty leaf arrays", () => {
      const filters = {
        "evaluations.passed": { "eval-1": [], "eval-2": [] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({});
    });
  });

  describe("when filter has mixed empty and non-empty entries", () => {
    it("keeps only non-empty entries", () => {
      const filters = {
        "spans.model": ["gpt-4"],
        "evaluations.passed": { "eval-1": [] },
        "traces.origin": ["application"],
      } as Partial<Record<FilterField, FilterParam>>;

      const result = filterOutEmptyFilters(filters);

      expect(result).toEqual({
        "spans.model": ["gpt-4"],
        "traces.origin": ["application"],
      });
    });
  });

  describe("when filter value is null or undefined", () => {
    it("strips null values without crashing", () => {
      const filters = {
        "spans.model": null,
      } as unknown as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({});
    });
  });
});
