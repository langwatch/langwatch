/**
 * @vitest-environment jsdom
 *
 * Integration tests for useFilterParams localStorage fallback.
 * Proves that when a saved view is stored in localStorage and the URL has no
 * filters, useFilterParams returns the view's filters on the very first render
 * — no double query, no race condition.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockRouterQuery: Record<string, string | string[] | undefined> = {};
let mockRouterAsPath = "/test-project/messages";

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: vi.fn().mockResolvedValue(true),
    pathname: "/[project]/messages",
    asPath: mockRouterAsPath,
  }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

vi.mock("../../components/PeriodSelector", () => ({
  usePeriodSelector: () => ({
    period: {
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-31"),
    },
  }),
}));

vi.mock("../../server/analytics/utils", () => ({
  filterOutEmptyFilters: (filters: Record<string, unknown>) => filters,
}));

vi.mock("../../server/filters/registry", () => ({
  availableFilters: {
    "traces.origin": { urlKey: "origin", name: "Origin" },
    "traces.error": { urlKey: "errors", name: "Error" },
  },
}));

// ---------------------------------------------------------------------------
// System under test
// ---------------------------------------------------------------------------

import { useFilterParams } from "../useFilterParams";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cacheKey(projectId: string) {
  return `langwatch-saved-views-cache-${projectId}`;
}

function selectedKey(projectId: string) {
  return `langwatch-saved-views-selected-${projectId}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFilterParams() saved view localStorage fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = {};
    mockRouterAsPath = "/test-project/messages";
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("when URL has no filters and a saved view is stored", () => {
    it("returns the stored view's filters on first render", () => {
      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toEqual(["application"]);
    });

    it("returns filters for error filter type", () => {
      localStorage.setItem(selectedKey("test-project"), "error-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "error-view",
            name: "Errors",
            filters: { "traces.error": ["true"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.error"]).toEqual(["true"]);
    });

    it("returns multiple filter fields from stored view", () => {
      localStorage.setItem(selectedKey("test-project"), "combo-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "combo-view",
            name: "Combo",
            filters: {
              "traces.origin": ["evaluation"],
              "traces.error": ["true"],
            },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toEqual(["evaluation"]);
      expect(result.current.filters["traces.error"]).toEqual(["true"]);
    });
  });

  describe("when URL has filters", () => {
    it("uses URL filters and ignores localStorage", () => {
      mockRouterAsPath = "/test-project/messages?origin=evaluation";
      mockRouterQuery = { origin: "evaluation" };

      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      // Should use URL value, not localStorage value
      expect(result.current.filters["traces.origin"]).toEqual(["evaluation"]);
    });
  });

  describe("when selected view is all-traces", () => {
    it("returns no filters", () => {
      localStorage.setItem(selectedKey("test-project"), "all-traces");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });

  describe("when no selected view is stored", () => {
    it("returns no filters", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });

  describe("when no cached views exist", () => {
    it("returns no filters even with a selected view ID", () => {
      localStorage.setItem(selectedKey("test-project"), "app-view");
      // No cache stored

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });

  describe("when stored view has unknown filter keys", () => {
    it("ignores filter keys not in availableFilters", () => {
      localStorage.setItem(selectedKey("test-project"), "unknown-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "unknown-view",
            name: "Unknown",
            filters: { "unknown.field": ["value"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(Object.keys(result.current.filters)).toHaveLength(0);
    });
  });

  describe("when localStorage is corrupt", () => {
    it("gracefully returns no filters", () => {
      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(cacheKey("test-project"), "not-valid-json{{{");

      const { result } = renderHook(() => useFilterParams());

      expect(Object.keys(result.current.filters)).toHaveLength(0);
    });
  });

  describe("when legacy selected key is used", () => {
    it("falls back to the legacy key format", () => {
      localStorage.setItem(
        `langwatch-selected-view-test-project`,
        "app-view",
      );
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toEqual(["application"]);
    });
  });

  describe("when URL has date params but no filters (shared link)", () => {
    it("does not apply saved view filters on top of shared dates", () => {
      mockRouterAsPath =
        "/test-project/messages?startDate=2025-01-01&endDate=2025-01-31";
      mockRouterQuery = {
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      };

      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      // Dates in URL means someone shared a link — don't override
      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });

  describe("when URL has only layout params like view=table", () => {
    it("still applies saved view filters (layout params are not filter/date params)", () => {
      mockRouterAsPath = "/test-project/messages?view=table";
      mockRouterQuery = { view: "table" };

      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      // Layout params like view=table should NOT prevent the fallback
      expect(result.current.filters["traces.origin"]).toEqual(["application"]);
    });
  });

  describe("when URL has a search query param", () => {
    it("does not apply saved view filters", () => {
      mockRouterAsPath = "/test-project/messages?query=hello";
      mockRouterQuery = { query: "hello" };

      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([
          {
            id: "app-view",
            name: "Application",
            filters: { "traces.origin": ["application"] },
          },
        ]),
      );

      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });
});
