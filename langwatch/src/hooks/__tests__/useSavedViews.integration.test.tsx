/**
 * @vitest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRouterPush = vi.fn();
let mockRouterQuery: Record<string, string | string[] | undefined> = {};

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: mockRouterPush,
    pathname: "/test",
    asPath: "/test",
  }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

vi.mock("../useFilterParams", () => ({
  useFilterParams: () => ({
    filters: {},
  }),
}));

vi.mock("../../server/filters/registry", () => ({
  availableFilters: {},
}));

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn().mockReturnValue({
  mutate: vi.fn(),
});

vi.mock("../../utils/api", () => ({
  api: {
    savedViews: {
      getAll: {
        useQuery: (...args: unknown[]) => mockUseQuery(...args),
      },
      create: { useMutation: (...args: unknown[]) => mockUseMutation(...args) },
      delete: { useMutation: (...args: unknown[]) => mockUseMutation(...args) },
      rename: { useMutation: (...args: unknown[]) => mockUseMutation(...args) },
      reorder: {
        useMutation: (...args: unknown[]) => mockUseMutation(...args),
      },
    },
    useContext: () => ({
      savedViews: {
        getAll: {
          invalidate: vi.fn(),
          setData: vi.fn(),
        },
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// System under test
// ---------------------------------------------------------------------------

import { SavedViewsProvider, useSavedViews } from "../useSavedViews";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <SavedViewsProvider>{children}</SavedViewsProvider>;
}

function cacheKey(projectId: string) {
  return `langwatch-saved-views-cache-${projectId}`;
}

function selectedKey(projectId: string) {
  return `langwatch-saved-views-selected-${projectId}`;
}

function legacySelectedKey(projectId: string) {
  return `langwatch-selected-view-${projectId}`;
}

const sampleDbViews = [
  {
    id: "view-1",
    name: "Error Traces",
    filters: { "traces.error": ["true"] },
    query: null,
    period: null,
  },
  {
    id: "view-2",
    name: "GPT Only",
    filters: { "spans.model": ["gpt-4"] },
    query: null,
    period: null,
  },
];

const updatedDbViews = [
  ...sampleDbViews,
  {
    id: "view-3",
    name: "Claude Only",
    filters: { "spans.model": ["claude-3"] },
    query: null,
    period: null,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSavedViews() localStorage caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = {};
    mockRouterPush.mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ---- 1. Cache write ----

  describe("when tRPC returns saved views data", () => {
    it("writes the views to localStorage under the cache key", () => {
      mockUseQuery.mockReturnValue({
        data: sampleDbViews,
        isFetched: true,
      });

      renderHook(() => useSavedViews(), { wrapper });

      const stored = localStorage.getItem(cacheKey("test-project"));
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("view-1");
      expect(parsed[1].id).toBe("view-2");
    });

    it("converts DB views to client format before caching", () => {
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "db-view",
            name: "DB View",
            userId: "user-1",
            filters: { "spans.model": ["gpt-4"] },
            query: "search",
            period: { relativeDays: 7 },
          },
        ],
        isFetched: true,
      });

      renderHook(() => useSavedViews(), { wrapper });

      const parsed = JSON.parse(
        localStorage.getItem(cacheKey("test-project"))!
      );
      expect(parsed[0]).toEqual({
        id: "db-view",
        name: "DB View",
        userId: "user-1",
        filters: { "spans.model": ["gpt-4"] },
        query: "search",
        period: { relativeDays: 7 },
      });
    });
  });

  // ---- 2. Cache read on mount ----

  describe("when localStorage has cached views and tRPC has not resolved", () => {
    it("populates customViews immediately from cache", () => {
      const cachedViews = [
        { id: "cached-1", name: "Cached View", filters: {} },
      ];
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify(cachedViews)
      );

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.customViews).toHaveLength(1);
      expect(result.current.customViews[0]!.id).toBe("cached-1");
      expect(result.current.customViews[0]!.name).toBe("Cached View");
    });

    it("reports isInitialized as true even before tRPC resolves", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([{ id: "v1", name: "V1", filters: {} }])
      );

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.isInitialized).toBe(true);
    });
  });

  describe("when localStorage is empty and tRPC has not resolved", () => {
    it("returns empty customViews", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.customViews).toEqual([]);
    });

    it("reports isInitialized as false", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.isInitialized).toBe(false);
    });
  });

  // ---- 3. Server refresh overwrites cache ----

  describe("when tRPC returns newer data after cache was used", () => {
    it("replaces customViews with server data", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([{ id: "old-1", name: "Old View", filters: {} }])
      );

      mockUseQuery.mockReturnValue({
        data: sampleDbViews,
        isFetched: true,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.customViews).toHaveLength(2);
      expect(result.current.customViews[0]!.id).toBe("view-1");
      expect(result.current.customViews[1]!.id).toBe("view-2");
    });

    it("updates localStorage with the newer data", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([{ id: "old-1", name: "Old View", filters: {} }])
      );

      mockUseQuery.mockReturnValue({
        data: updatedDbViews,
        isFetched: true,
      });

      renderHook(() => useSavedViews(), { wrapper });

      const stored = JSON.parse(
        localStorage.getItem(cacheKey("test-project"))!
      );
      expect(stored).toHaveLength(3);
      expect(stored[2].id).toBe("view-3");
    });
  });

  // ---- 4. Selected view ID persistence ----

  describe("when a view is selected via handleViewClick", () => {
    it("persists the selected view ID in localStorage", () => {
      mockUseQuery.mockReturnValue({
        data: sampleDbViews,
        isFetched: true,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      act(() => {
        result.current.handleViewClick("view-1");
      });

      const storedId = localStorage.getItem(selectedKey("test-project"));
      expect(storedId).toBe("view-1");
    });

    it("updates selectedViewId state", () => {
      mockUseQuery.mockReturnValue({
        data: sampleDbViews,
        isFetched: true,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      act(() => {
        result.current.handleViewClick("view-2");
      });

      expect(result.current.selectedViewId).toBe("view-2");
    });
  });

  describe("when mounting with the legacy selected view key", () => {
    it("reads the selected view ID from the legacy key", () => {
      // Store under legacy key only
      localStorage.setItem(legacySelectedKey("test-project"), "view-1");

      // tRPC not resolved yet, no cache -> isInitialized = false
      // This means matching effect skips. The project change effect
      // reads from localStorage and sets selectedViewId.
      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      // When isInitialized is false, the matching effect is skipped,
      // so the stored value from the legacy key survives.
      expect(result.current.selectedViewId).toBe("view-1");
    });
  });

  describe("when both new and legacy selected keys exist", () => {
    it("prefers the new key over the legacy key", () => {
      localStorage.setItem(selectedKey("test-project"), "view-2");
      localStorage.setItem(legacySelectedKey("test-project"), "view-1");

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.selectedViewId).toBe("view-2");
    });
  });

  describe("when only the new selected key exists", () => {
    it("reads from the new key", () => {
      localStorage.setItem(selectedKey("test-project"), "view-2");

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      expect(result.current.selectedViewId).toBe("view-2");
    });
  });

  // ---- 5. Instant filter restore ----

  describe("when tRPC transitions from loading to resolved with a stored selected view", () => {
    it("applies the selected view filters via router.push when isInitialized becomes true", async () => {
      // Pre-seed localStorage with a cached view list and a selected view ID
      const viewWithFilters = [
        {
          id: "filtered-view",
          name: "Error Filter",
          filters: { "traces.error": ["true"] },
        },
      ];
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify(viewWithFilters)
      );
      localStorage.setItem(selectedKey("test-project"), "filtered-view");

      // Start with tRPC not fetched, BUT cache makes isInitialized true.
      // The restore effect fires on the first render where isInitialized = true
      // and selectedViewId has been set by the project change effect.
      // We simulate the real scenario: no cache, tRPC resolves later.
      // Without cache, isInitialized starts as false.
      localStorage.removeItem(cacheKey("test-project"));

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result, rerender } = renderHook(() => useSavedViews(), {
        wrapper,
      });

      // Before tRPC resolves: selectedViewId is set from localStorage
      // but isInitialized is false, so no filters applied yet
      expect(result.current.isInitialized).toBe(false);
      expect(mockRouterPush).not.toHaveBeenCalled();

      // tRPC resolves with the view data
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "filtered-view",
            name: "Error Filter",
            filters: { "traces.error": ["true"] },
            query: null,
            period: null,
          },
        ],
        isFetched: true,
      });

      rerender();

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalled();
      });
    });
  });

  describe("when selected view is all-traces with cached views", () => {
    it("does not push filters to router", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify(sampleDbViews)
      );
      localStorage.setItem(selectedKey("test-project"), "all-traces");

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      renderHook(() => useSavedViews(), { wrapper });

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  describe("when no selected view is stored", () => {
    it("does not push filters to router on mount", () => {
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify(sampleDbViews)
      );
      // No selected view stored

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      renderHook(() => useSavedViews(), { wrapper });

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });
});
