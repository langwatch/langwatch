/**
 * What the address says the charts are narrowed to.
 *
 * The reading and the counting are pure here so the two failures that matter
 * are unit-testable: a filter the reader set that the charts never see, and a
 * filter the reader cleared that the charts still apply.
 */

import { describe, expect, it } from "vitest";

import {
  countFilters,
  filterOutEmptyFilters,
  isFilterQueryKey,
  readFiltersFromQuery,
} from "../analytics-filter-params";

describe("the analytics filter params", () => {
  describe("given a query string carrying a filter", () => {
    describe("when the filters are read", () => {
      it("keys them by field rather than by the URL key they arrived under", () => {
        expect(readFiltersFromQuery({ origin: ["api"] })).toEqual({
          "traces.origin": ["api"],
        });
      });

      it("lifts a single value into the list shape every procedure takes", () => {
        expect(readFiltersFromQuery({ origin: "api" })).toEqual({
          "traces.origin": ["api"],
        });
      });

      it("ignores query keys that name no filter", () => {
        expect(readFiltersFromQuery({ show_filters: "true", period: "7d" })).toEqual({});
      });
    });
  });

  describe("given a filter the reader has emptied", () => {
    describe("when the filters are trimmed for a read", () => {
      /** @scenario "A filter the reader emptied stops narrowing the charts" */
      it("drops an empty list, so an emptied filter stops narrowing", () => {
        expect(filterOutEmptyFilters({ "traces.origin": [] })).toEqual({});
      });

      /**
       * A SHALLOW check on purpose. `{ "eval-1": [] }` means "the key is
       * picked, its values are still coming"; dropping it would close the
       * nested picker the moment a reader opened it.
       */
      /** @scenario "A filter whose values are still being chosen is kept" */
      it("keeps a keyed filter whose values are still being chosen", () => {
        expect(filterOutEmptyFilters({ "evaluations.score": { "eval-1": [] } })).toEqual({
          "evaluations.score": { "eval-1": [] },
        });
      });
    });
  });

  describe("given a mix of set and empty filters", () => {
    describe("when they are counted for the trigger's badge", () => {
      it("counts only the ones that narrow anything", () => {
        const counted = countFilters({
          "traces.origin": ["api"],
          "spans.model": [],
        });

        expect(counted.filterCount).toBe(1);
        expect(counted.hasAnyFilters).toBe(true);
      });

      it("reports no filters at all when every one of them is empty", () => {
        expect(countFilters({ "traces.origin": [] }).hasAnyFilters).toBe(false);
      });
    });
  });

  describe("given a query key", () => {
    describe("when a clear decides whether to drop it", () => {
      it("recognises a filter's own key", () => {
        expect(isFilterQueryKey("origin")).toBe(true);
      });

      it("recognises a filter's nested keys, which is what clearing must remove", () => {
        expect(isFilterQueryKey("evaluation_score.eval-1")).toBe(true);
      });

      /** @scenario "Clearing the filters leaves the page's own parameters alone" */
      it("leaves the page's own parameters alone", () => {
        expect(isFilterQueryKey("period")).toBe(false);
        expect(isFilterQueryKey("dashboard")).toBe(false);
      });
    });
  });
});
