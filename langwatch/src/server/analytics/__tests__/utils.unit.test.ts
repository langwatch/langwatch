import { describe, expect, it } from "vitest";
import { countActiveFilters, filterOutEmptyFilters } from "../utils";
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

    it("keeps objects with empty leaf arrays (key selected, sub-values pending)", () => {
      const filters = {
        "evaluations.passed": { "eval-1": [] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({
        "evaluations.passed": { "eval-1": [] },
      });
    });
  });

  describe("when filter is an empty object", () => {
    it("strips empty objects", () => {
      const filters = {
        "evaluations.passed": {},
      } as Partial<Record<FilterField, FilterParam>>;

      expect(filterOutEmptyFilters(filters)).toEqual({});
    });
  });

  describe("when filter has mixed empty and non-empty entries", () => {
    it("keeps all non-empty entries including pending nested selections", () => {
      const filters = {
        "spans.model": ["gpt-4"],
        "evaluations.passed": { "eval-1": [] },
        "traces.origin": ["application"],
        "evaluations.score": {},
      } as Partial<Record<FilterField, FilterParam>>;

      const result = filterOutEmptyFilters(filters);

      expect(result).toEqual({
        "spans.model": ["gpt-4"],
        "evaluations.passed": { "eval-1": [] },
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

describe("countActiveFilters()", () => {
  describe("when filters is undefined", () => {
    it("returns 0", () => {
      expect(countActiveFilters(undefined)).toBe(0);
    });
  });

  describe("when filter has non-empty leaf arrays", () => {
    it("counts each filter with active conditions", () => {
      const filters = {
        "spans.model": ["gpt-4"],
        "traces.origin": ["application"],
      } as Partial<Record<FilterField, FilterParam>>;

      expect(countActiveFilters(filters)).toBe(2);
    });
  });

  describe("when filter is a nested object with empty leaf arrays", () => {
    it("does not count filters without active conditions", () => {
      const filters = {
        "evaluations.passed": { "eval-1": [] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(countActiveFilters(filters)).toBe(0);
    });
  });

  describe("when filter is a nested object with non-empty leaf arrays", () => {
    it("counts the filter", () => {
      const filters = {
        "evaluations.passed": { "eval-1": ["true"] },
      } as Partial<Record<FilterField, FilterParam>>;

      expect(countActiveFilters(filters)).toBe(1);
    });
  });

  describe("when filters have a mix of active and pending", () => {
    it("only counts filters with active conditions", () => {
      const filters = {
        "spans.model": ["gpt-4"],
        "evaluations.passed": { "eval-1": [] },
        "evaluations.score": {},
        "traces.origin": [],
      } as Partial<Record<FilterField, FilterParam>>;

      expect(countActiveFilters(filters)).toBe(1);
    });
  });
});
