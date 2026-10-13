/**
 * What the address says the charts are narrowed to: reading and counting
 * are pure so the two failures that matter are unit-testable — a filter
 * set that charts never see, and a filter cleared that charts still apply.
 */

import { describe, expect, it } from "vitest";

import {
  countFilters,
  filterOutEmptyFilters,
  isFilterQueryKey,
  readFiltersFromQuery,
  readSavedViewFilters,
} from "../analytics-filter-params.ts";

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

  describe("given a saved view selected for the project", () => {
    const stored: Record<string, string> = {
      "langwatch-saved-views-selected-p1": "view-1",
      "langwatch-saved-views-cache-p1": JSON.stringify([
        { id: "view-1", filters: { "traces.origin": ["api"], "no.such.field": ["x"] } },
      ]),
    };
    const readStorage = (key: string) => stored[key];

    describe("when the address narrows nothing", () => {
      it("uses the view's filters, keeping only fields the registry knows", () => {
        expect(readSavedViewFilters({ queryParams: {}, projectId: "p1", readStorage })).toEqual({
          "traces.origin": ["api"],
        });
      });
    });

    describe("when the address already carries a filter or a search", () => {
      it("leaves the view out", () => {
        expect(
          readSavedViewFilters({ queryParams: { origin: "web" }, projectId: "p1", readStorage }),
        ).toEqual({});
        expect(
          readSavedViewFilters({ queryParams: { query: "hi" }, projectId: "p1", readStorage }),
        ).toEqual({});
      });
    });

    describe("when the cache is corrupt", () => {
      it("reads as no view rather than failing", () => {
        const corrupt = (key: string) => (key.includes("cache") ? "{" : stored[key]);
        expect(
          readSavedViewFilters({ queryParams: {}, projectId: "p1", readStorage: corrupt }),
        ).toEqual({});
      });
    });
  });
});
