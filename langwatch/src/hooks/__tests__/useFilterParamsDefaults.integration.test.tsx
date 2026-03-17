/**
 * @vitest-environment jsdom
 *
 * Integration tests for useFilterParams default filters via FilterDefaultsProvider.
 * Proves that the analytics page can inject default origin filters that apply
 * when the URL has no origin filter, and that URL filters take precedence.
 */
import { renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockRouterQuery: Record<string, string | string[] | undefined> = {};
let mockRouterAsPath = "/test-project/analytics";

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: vi.fn().mockResolvedValue(true),
    pathname: "/[project]/analytics",
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

import { useFilterParams, FilterDefaultsProvider } from "../useFilterParams";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFilterParams() with FilterDefaultsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = {};
    mockRouterAsPath = "/test-project/analytics";
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("when no origin filter is in the URL", () => {
    it("applies default origin filter from provider", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{ "traces.origin": ["application"] }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      expect(result.current.filters["traces.origin"]).toEqual(["application"]);
    });

    it("includes default filter in filterParams.filters", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{ "traces.origin": ["application"] }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      expect(result.current.filterParams.filters["traces.origin"]).toEqual([
        "application",
      ]);
    });
  });

  describe("when user sets origin filter via URL", () => {
    it("uses the URL filter instead of the default", () => {
      mockRouterAsPath = "/test-project/analytics?origin=simulation";
      mockRouterQuery = { origin: "simulation" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{ "traces.origin": ["application"] }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      expect(result.current.filters["traces.origin"]).toEqual(["simulation"]);
    });

    it("uses multiple URL origin values when provided", () => {
      mockRouterAsPath =
        "/test-project/analytics?origin=simulation,evaluation";
      mockRouterQuery = { origin: "simulation,evaluation" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{ "traces.origin": ["application"] }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      expect(result.current.filters["traces.origin"]).toEqual([
        "simulation",
        "evaluation",
      ]);
    });
  });

  describe("when no FilterDefaultsProvider wraps the hook", () => {
    it("returns no default filters (backward compatible)", () => {
      const { result } = renderHook(() => useFilterParams());

      expect(result.current.filters["traces.origin"]).toBeUndefined();
    });
  });

  describe("when provider sets defaults for multiple filter fields", () => {
    it("applies all default filters", () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{
            "traces.origin": ["application"],
            "traces.error": ["false"],
          }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      expect(result.current.filters["traces.origin"]).toEqual(["application"]);
      expect(result.current.filters["traces.error"]).toEqual(["false"]);
    });

    it("overrides only the filter present in URL", () => {
      mockRouterAsPath = "/test-project/analytics?origin=simulation";
      mockRouterQuery = { origin: "simulation" };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <FilterDefaultsProvider
          defaults={{
            "traces.origin": ["application"],
            "traces.error": ["false"],
          }}
        >
          {children}
        </FilterDefaultsProvider>
      );

      const { result } = renderHook(() => useFilterParams(), { wrapper });

      // URL overrides origin
      expect(result.current.filters["traces.origin"]).toEqual(["simulation"]);
      // Default still applies for error
      expect(result.current.filters["traces.error"]).toEqual(["false"]);
    });
  });
});
