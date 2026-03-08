/**
 * @vitest-environment jsdom
 */
import { subDays } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FilterParam } from "../useFilterParams";
import type { FilterField } from "../../server/filters/types";
import {
  DEFAULT_VIEWS,
  filtersMatch,
  findMatchingView,
  getStorageKey,
  MAX_VIEW_NAME_LENGTH,
  normalizeFilterValue,
  readSavedViewsFromStorage,
  SAVED_VIEWS_SCHEMA_VERSION,
  SEED_VIEWS,
  type SavedView,
  type SavedViewsStorage,
  writeSavedViewsToStorage,
} from "../savedViewsLogic";

describe("savedViewsLogic", () => {
  // --- localStorage ---

  describe("getStorageKey()", () => {
    it("returns key scoped to projectId", () => {
      expect(getStorageKey("proj-123")).toBe("langwatch-saved-views-proj-123");
    });
  });

  describe("readSavedViewsFromStorage()", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    describe("when localStorage is empty", () => {
      it("returns seeded views on first load", () => {
        const result = readSavedViewsFromStorage("proj-1");
        expect(result).toEqual({
          schemaVersion: SAVED_VIEWS_SCHEMA_VERSION,
          views: SEED_VIEWS,
          selectedViewId: null,
        });
      });

      it("persists seeded views to localStorage", () => {
        readSavedViewsFromStorage("proj-1");
        const stored = JSON.parse(
          localStorage.getItem(getStorageKey("proj-1"))!,
        );
        expect(stored.views).toHaveLength(SEED_VIEWS.length);
        expect(stored.views[0].id).toBe("application");
      });
    });

    describe("when localStorage has valid data", () => {
      it("returns the stored views and selection", () => {
        const stored: SavedViewsStorage = {
          schemaVersion: 1,
          views: [
            {
              id: "v1",
              name: "My View",
              filters: { "spans.model": ["gpt-4"] },
            },
          ],
          selectedViewId: "v1",
        };
        localStorage.setItem(
          getStorageKey("proj-1"),
          JSON.stringify(stored),
        );

        const result = readSavedViewsFromStorage("proj-1");
        expect(result.views).toHaveLength(1);
        expect(result.views[0]!.name).toBe("My View");
        expect(result.selectedViewId).toBe("v1");
        expect(result.schemaVersion).toBe(1);
      });
    });

    describe("when localStorage has corrupt JSON", () => {
      it("returns defaults and replaces corrupt data", () => {
        localStorage.setItem(
          getStorageKey("proj-1"),
          "not valid json{{{",
        );

        const result = readSavedViewsFromStorage("proj-1");
        expect(result.views).toEqual([]);
        expect(result.selectedViewId).toBeNull();

        // Should have replaced with valid defaults
        const stored = JSON.parse(
          localStorage.getItem(getStorageKey("proj-1"))!,
        );
        expect(stored.schemaVersion).toBe(SAVED_VIEWS_SCHEMA_VERSION);
        expect(stored.views).toEqual([]);
      });
    });

    describe("when localStorage has structurally invalid data", () => {
      it("returns defaults when missing schemaVersion", () => {
        localStorage.setItem(
          getStorageKey("proj-1"),
          JSON.stringify({ views: [] }),
        );

        const result = readSavedViewsFromStorage("proj-1");
        expect(result.views).toEqual([]);
        expect(result.schemaVersion).toBe(SAVED_VIEWS_SCHEMA_VERSION);
      });

      it("returns defaults when views is not an array", () => {
        localStorage.setItem(
          getStorageKey("proj-1"),
          JSON.stringify({ schemaVersion: 1, views: "not-array" }),
        );

        const result = readSavedViewsFromStorage("proj-1");
        expect(result.views).toEqual([]);
      });

      it("returns defaults for null data", () => {
        localStorage.setItem(getStorageKey("proj-1"), "null");

        const result = readSavedViewsFromStorage("proj-1");
        expect(result.views).toEqual([]);
      });
    });

    describe("when reading for different projects", () => {
      it("returns project-scoped data", () => {
        const storeA: SavedViewsStorage = {
          schemaVersion: 1,
          views: [{ id: "a1", name: "Alpha View", filters: {} }],
          selectedViewId: "a1",
        };
        const storeB: SavedViewsStorage = {
          schemaVersion: 1,
          views: [{ id: "b1", name: "Beta View", filters: {} }],
          selectedViewId: "b1",
        };

        localStorage.setItem(
          getStorageKey("proj-alpha"),
          JSON.stringify(storeA),
        );
        localStorage.setItem(
          getStorageKey("proj-beta"),
          JSON.stringify(storeB),
        );

        expect(readSavedViewsFromStorage("proj-alpha").views).toHaveLength(1);
        expect(readSavedViewsFromStorage("proj-beta").views).toHaveLength(1);
      });
    });
  });

  describe("writeSavedViewsToStorage()", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it("writes data with schemaVersion", () => {
      const data: SavedViewsStorage = {
        schemaVersion: SAVED_VIEWS_SCHEMA_VERSION,
        views: [{ id: "v1", name: "Test", filters: {} }],
        selectedViewId: "v1",
      };

      writeSavedViewsToStorage("proj-1", data);

      const stored = JSON.parse(
        localStorage.getItem(getStorageKey("proj-1"))!,
      );
      expect(stored.schemaVersion).toBe(SAVED_VIEWS_SCHEMA_VERSION);
      expect(stored.views).toHaveLength(1);
      expect(stored.selectedViewId).toBe("v1");
    });
  });

  // --- normalizeFilterValue ---

  describe("normalizeFilterValue()", () => {
    describe("when value is undefined or null", () => {
      it("returns undefined", () => {
        expect(normalizeFilterValue(undefined)).toBeUndefined();
        expect(
          normalizeFilterValue(null as unknown as undefined),
        ).toBeUndefined();
      });
    });

    describe("when value is an empty array", () => {
      it("returns undefined", () => {
        expect(normalizeFilterValue([])).toBeUndefined();
      });
    });

    describe("when value is a non-empty array", () => {
      it("returns sorted array", () => {
        expect(normalizeFilterValue(["c", "a", "b"])).toEqual([
          "a",
          "b",
          "c",
        ]);
      });
    });

    describe("when value is a record with empty arrays", () => {
      it("returns undefined", () => {
        const val: FilterParam = { key1: [] };
        expect(normalizeFilterValue(val)).toBeUndefined();
      });
    });

    describe("when value is a record with non-empty arrays", () => {
      it("sorts the arrays and keys", () => {
        const val: FilterParam = {
          z: ["b", "a"],
          a: ["d", "c"],
        } as unknown as FilterParam;
        const result = normalizeFilterValue(val);
        expect(result).toEqual({ a: ["c", "d"], z: ["a", "b"] });
      });
    });
  });

  // --- filtersMatch ---

  describe("filtersMatch()", () => {
    describe("when both filters are empty", () => {
      it("returns true", () => {
        expect(filtersMatch({}, {})).toBe(true);
      });
    });

    describe("when filters match exactly", () => {
      it("returns true", () => {
        const a: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4"],
        };
        const b: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4"],
        };
        expect(filtersMatch(a, b)).toBe(true);
      });
    });

    describe("when arrays have different order", () => {
      it("returns true (order-insensitive)", () => {
        const a: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4", "claude-3"],
        };
        const b: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["claude-3", "gpt-4"],
        };
        expect(filtersMatch(a, b)).toBe(true);
      });
    });

    describe("when one side has extra filter", () => {
      it("returns false", () => {
        const a: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4"],
        };
        const b: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4"],
          "traces.error": ["true"],
        };
        expect(filtersMatch(a, b)).toBe(false);
      });
    });

    describe("when one side has empty array (treated as absent)", () => {
      it("returns true when comparing empty array vs missing", () => {
        const a: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": [],
        };
        const b: Partial<Record<FilterField, FilterParam>> = {};
        expect(filtersMatch(a, b)).toBe(true);
      });
    });

    describe("when filter values differ", () => {
      it("returns false", () => {
        const a: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["gpt-4"],
        };
        const b: Partial<Record<FilterField, FilterParam>> = {
          "spans.model": ["claude-3"],
        };
        expect(filtersMatch(a, b)).toBe(false);
      });
    });
  });

  // --- findMatchingView ---

  describe("findMatchingView()", () => {
    const customViews: SavedView[] = [
      ...SEED_VIEWS,
      {
        id: "custom-1",
        name: "Debug",
        filters: { "spans.model": ["gpt-4"] },
      },
      {
        id: "custom-2",
        name: "Timeout Errors",
        filters: { "metadata.user_id": ["user-123"] },
        query: "error timeout",
      },
    ];

    describe("when no filters and no query", () => {
      it("returns all-traces", () => {
        const result = findMatchingView({
          currentFilters: {},
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("all-traces");
      });
    });

    describe("when filters match a seeded origin view", () => {
      it("returns the matching view id for evaluation", () => {
        const result = findMatchingView({
          currentFilters: { "traces.origin": ["evaluation"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("evaluations");
      });
    });

    describe("when filters match application origin", () => {
      it("returns application view id", () => {
        const result = findMatchingView({
          currentFilters: { "traces.origin": ["application"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("application");
      });
    });

    describe("when filters match simulation origin", () => {
      it("returns simulations view id", () => {
        const result = findMatchingView({
          currentFilters: { "traces.origin": ["simulation"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("simulations");
      });
    });

    describe("when filters match playground origin", () => {
      it("returns playground view id", () => {
        const result = findMatchingView({
          currentFilters: { "traces.origin": ["playground"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("playground");
      });
    });

    describe("when filters match a custom view", () => {
      it("returns the custom view id", () => {
        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBe("custom-1");
      });
    });

    describe("when filters and query match a custom view", () => {
      it("returns the custom view id", () => {
        const result = findMatchingView({
          currentFilters: { "metadata.user_id": ["user-123"] },
          currentQuery: "error timeout",
          customViews,
        });
        expect(result).toBe("custom-2");
      });
    });

    describe("when filters match but query differs", () => {
      it("returns null", () => {
        const result = findMatchingView({
          currentFilters: { "metadata.user_id": ["user-123"] },
          currentQuery: "different query",
          customViews,
        });
        expect(result).toBeNull();
      });
    });

    describe("when no view matches", () => {
      it("returns null", () => {
        const result = findMatchingView({
          currentFilters: { "traces.error": ["true"] },
          currentQuery: undefined,
          customViews,
        });
        expect(result).toBeNull();
      });
    });

    describe("when array order differs from saved view", () => {
      it("still matches (order-insensitive)", () => {
        const views: SavedView[] = [
          {
            id: "multi",
            name: "Multi Model",
            filters: { "spans.model": ["gpt-4", "claude-3"] },
          },
        ];
        const result = findMatchingView({
          currentFilters: { "spans.model": ["claude-3", "gpt-4"] },
          currentQuery: undefined,
          customViews: views,
        });
        expect(result).toBe("multi");
      });
    });

    describe("when empty string query matches undefined", () => {
      it("treats empty string as no query", () => {
        const result = findMatchingView({
          currentFilters: {},
          currentQuery: "",
          customViews: [],
        });
        expect(result).toBe("all-traces");
      });
    });

    describe("when origin filter plus extra filters with no matching custom view", () => {
      it("returns null", () => {
        const result = findMatchingView({
          currentFilters: {
            "traces.origin": ["evaluation"],
            "spans.model": ["gpt-4"],
          },
          currentQuery: undefined,
          customViews: [],
        });
        expect(result).toBeNull();
      });
    });

    // --- period matching ---

    describe("when view has no period", () => {
      it("matches regardless of URL dates", () => {
        const views: SavedView[] = [
          { id: "no-period", name: "No Period", filters: { "spans.model": ["gpt-4"] } },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlStartDate: "2025-01-01T00:00:00.000Z",
          urlEndDate: "2025-01-31T00:00:00.000Z",
          urlHasDateParams: true,
        });
        expect(result).toBe("no-period");
      });

      it("matches when URL has no date params", () => {
        const views: SavedView[] = [
          { id: "no-period", name: "No Period", filters: { "spans.model": ["gpt-4"] } },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlHasDateParams: false,
        });
        expect(result).toBe("no-period");
      });
    });

    describe("when view has relativeDays period", () => {
      it("matches when URL date range has same days difference and end is recent", () => {
        const now = new Date();
        const start = subDays(now, 6); // 7 days range (6 diff + 1)
        const views: SavedView[] = [
          {
            id: "last-7d",
            name: "Last 7 Days",
            filters: { "spans.model": ["gpt-4"] },
            period: { relativeDays: 7 },
          },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlStartDate: start.toISOString(),
          urlEndDate: now.toISOString(),
          urlHasDateParams: true,
        });
        expect(result).toBe("last-7d");
      });

      it("does not match when URL has no date params", () => {
        const views: SavedView[] = [
          {
            id: "last-7d",
            name: "Last 7 Days",
            filters: { "spans.model": ["gpt-4"] },
            period: { relativeDays: 7 },
          },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlHasDateParams: false,
        });
        expect(result).toBeNull();
      });

      it("does not match when days difference is wrong", () => {
        const now = new Date();
        const start = subDays(now, 13); // 14 days range, not 7
        const views: SavedView[] = [
          {
            id: "last-7d",
            name: "Last 7 Days",
            filters: { "spans.model": ["gpt-4"] },
            period: { relativeDays: 7 },
          },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlStartDate: start.toISOString(),
          urlEndDate: now.toISOString(),
          urlHasDateParams: true,
        });
        expect(result).toBeNull();
      });
    });

    describe("when view has fixed date period", () => {
      it("matches when URL dates match exactly", () => {
        const views: SavedView[] = [
          {
            id: "jan-2025",
            name: "January 2025",
            filters: { "spans.model": ["gpt-4"] },
            period: {
              startDate: "2025-01-01T00:00:00.000Z",
              endDate: "2025-01-31T23:59:59.999Z",
            },
          },
        ];

        const result = findMatchingView({
          currentFilters: { "spans.model": ["gpt-4"] },
          currentQuery: undefined,
          customViews: views,
          urlStartDate: "2025-01-01T00:00:00.000Z",
          urlEndDate: "2025-01-31T23:59:59.999Z",
          urlHasDateParams: true,
        });
        expect(result).toBe("jan-2025");
      });

      it("does not match when URL dates differ", () => {
        const views: SavedView[] = [
          {
            id: "jan-2025",
            name: "January 2025",
            filters: {},
            period: {
              startDate: "2025-01-01T00:00:00.000Z",
              endDate: "2025-01-31T23:59:59.999Z",
            },
          },
        ];

        const result = findMatchingView({
          currentFilters: {},
          currentQuery: undefined,
          customViews: views,
          urlStartDate: "2025-02-01T00:00:00.000Z",
          urlEndDate: "2025-02-28T23:59:59.999Z",
          urlHasDateParams: true,
        });
        expect(result).toBeNull();
      });

      it("does not match when URL has no date params", () => {
        const views: SavedView[] = [
          {
            id: "jan-2025",
            name: "January 2025",
            filters: {},
            period: {
              startDate: "2025-01-01T00:00:00.000Z",
              endDate: "2025-01-31T23:59:59.999Z",
            },
          },
        ];

        const result = findMatchingView({
          currentFilters: {},
          currentQuery: undefined,
          customViews: views,
          urlHasDateParams: false,
        });
        // No filters + no date params + view has period => won't match the view.
        // But also no filters => all-traces check runs first.
        // Since urlHasDateParams is false, all-traces is returned.
        expect(result).toBe("all-traces");
      });
    });

    describe("when URL has date params but no filters", () => {
      it("does not return all-traces", () => {
        const result = findMatchingView({
          currentFilters: {},
          currentQuery: undefined,
          customViews: [],
          urlHasDateParams: true,
          urlStartDate: "2025-01-01T00:00:00.000Z",
          urlEndDate: "2025-01-31T23:59:59.999Z",
        });
        // Has date params, so all-traces check fails, and no views match
        expect(result).toBeNull();
      });
    });
  });

  // --- DEFAULT_VIEWS ---

  describe("DEFAULT_VIEWS", () => {
    it("has 5 default views in order", () => {
      expect(DEFAULT_VIEWS).toHaveLength(5);
      expect(DEFAULT_VIEWS.map((v) => v.name)).toEqual([
        "All Traces",
        "Application",
        "Evaluations",
        "Simulations",
        "Playground",
      ]);
    });

    it("All Traces has null origin", () => {
      expect(DEFAULT_VIEWS[0]!.origin).toBeNull();
    });

    it("each non-all view has a string origin", () => {
      for (const view of DEFAULT_VIEWS.slice(1)) {
        expect(typeof view.origin).toBe("string");
      }
    });
  });

  // --- SEED_VIEWS ---

  describe("SEED_VIEWS", () => {
    it("has 4 seeded views matching the origin-based default views", () => {
      expect(SEED_VIEWS).toHaveLength(4);
      expect(SEED_VIEWS.map((v) => v.id)).toEqual([
        "application",
        "evaluations",
        "simulations",
        "playground",
      ]);
    });

    it("each seed view has an origin filter", () => {
      for (const view of SEED_VIEWS) {
        expect(view.filters["traces.origin"]).toBeDefined();
        expect(
          Array.isArray(view.filters["traces.origin"]),
        ).toBe(true);
      }
    });
  });

  // --- MAX_VIEW_NAME_LENGTH ---

  describe("MAX_VIEW_NAME_LENGTH", () => {
    it("is 50", () => {
      expect(MAX_VIEW_NAME_LENGTH).toBe(50);
    });
  });

  // --- SavedView schema ---

  describe("SavedView schema", () => {
    it("contains id, name, filters, optional query, and optional period", () => {
      const view: SavedView = {
        id: "v1",
        name: "Test",
        filters: { "spans.model": ["gpt-4"] },
        query: "search term",
        period: { relativeDays: 7 },
      };

      const keys = Object.keys(view);
      expect(keys).toContain("id");
      expect(keys).toContain("name");
      expect(keys).toContain("filters");
      expect(keys).toContain("query");
      expect(keys).toContain("period");
      expect(keys).not.toContain("group_by");
      expect(keys).not.toContain("negateFilters");
    });

    it("allows period with fixed start/end dates", () => {
      const view: SavedView = {
        id: "v2",
        name: "Fixed Range",
        filters: {},
        period: {
          startDate: "2025-01-01T00:00:00.000Z",
          endDate: "2025-01-31T23:59:59.999Z",
        },
      };

      expect(view.period?.startDate).toBe("2025-01-01T00:00:00.000Z");
      expect(view.period?.endDate).toBe("2025-01-31T23:59:59.999Z");
    });

    it("allows views without period", () => {
      const view: SavedView = {
        id: "v3",
        name: "No Period",
        filters: {},
      };

      expect(view.period).toBeUndefined();
    });
  });
});
