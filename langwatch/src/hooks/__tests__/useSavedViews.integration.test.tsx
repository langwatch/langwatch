/**
 * @vitest-environment jsdom
 *
 * Integration tests for useSavedViews hook covering:
 * - localStorage caching (views + selected view ID)
 * - router.push called with pathname (no "project" in URL)
 * - Full restore flow on page load
 * - View click applies filters correctly
 *
 * Uses mutable mockRouterQuery + rerender() pattern from evaluations-v3 tests.
 */
import {
  renderHook,
  act,
  waitFor,
  cleanup,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — mutable router query simulates Next.js URL changes
// ---------------------------------------------------------------------------

const mockRouterPush = vi.fn();
let mockRouterQuery: Record<string, string | string[] | undefined> = {};
let mockRouterAsPath = "/[project]/messages";
const MOCK_PATHNAME = "/[project]/messages";

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: mockRouterPush,
    pathname: MOCK_PATHNAME,
    asPath: mockRouterAsPath,
  }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

// Mock useFilterParams to return filters derived from mockRouterQuery
vi.mock("../useFilterParams", () => ({
  useFilterParams: () => {
    const filters: Record<string, string[]> = {};
    if (mockRouterQuery.origin) {
      const origin = mockRouterQuery.origin;
      filters["traces.origin"] = Array.isArray(origin)
        ? origin
        : [origin];
    }
    return { filters };
  },
}));

// Mock availableFilters with traces.origin so buildViewQuery can map filter fields to URL keys
vi.mock("../../server/filters/registry", () => ({
  availableFilters: {
    "traces.origin": { urlKey: "origin", name: "Origin" },
    "traces.error": { urlKey: "errors", name: "Error" },
  },
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

const applicationView = {
  id: "app-view",
  name: "Application",
  filters: { "traces.origin": ["application"] },
  query: null,
  period: null,
};

// Simulates the effect of router.push: update mockRouterQuery and mockRouterAsPath
function simulateRouterPush() {
  mockRouterPush.mockImplementation(
    (url: { pathname?: string; query?: Record<string, unknown> }) => {
      if (url.query) {
        mockRouterQuery = url.query as Record<
          string,
          string | string[] | undefined
        >;
      }
      if (url.pathname) {
        const queryString = Object.entries(url.query ?? {})
          .filter(([key]) => key !== "project")
          .map(([key, val]) => `${key}=${String(val)}`)
          .join("&");
        mockRouterAsPath = `${url.pathname.replace("[project]", "test-project")}${queryString ? `?${queryString}` : ""}`;
      }
      return Promise.resolve(true);
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSavedViews() localStorage caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = {};
    mockRouterAsPath = "/[project]/messages";
    mockRouterPush.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
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
        localStorage.getItem(cacheKey("test-project"))!,
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
        JSON.stringify(cachedViews),
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
        JSON.stringify([{ id: "v1", name: "V1", filters: {} }]),
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
        JSON.stringify([{ id: "old-1", name: "Old View", filters: {} }]),
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
        JSON.stringify([{ id: "old-1", name: "Old View", filters: {} }]),
      );

      mockUseQuery.mockReturnValue({
        data: updatedDbViews,
        isFetched: true,
      });

      renderHook(() => useSavedViews(), { wrapper });

      const stored = JSON.parse(
        localStorage.getItem(cacheKey("test-project"))!,
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
      localStorage.setItem(legacySelectedKey("test-project"), "view-1");

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

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
      localStorage.setItem(selectedKey("test-project"), "filtered-view");

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { result, rerender } = renderHook(() => useSavedViews(), {
        wrapper,
      });

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
        JSON.stringify(sampleDbViews),
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
        JSON.stringify(sampleDbViews),
      );

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      renderHook(() => useSavedViews(), { wrapper });

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Router pathname tests — prove "project" never leaks into URL
// ---------------------------------------------------------------------------

describe("useSavedViews() router.push always includes pathname", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = { project: "test-project" };
    mockRouterAsPath = "/test-project/messages";
    simulateRouterPush();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("when clicking a saved view pill", () => {
    it("calls router.push with pathname so project stays in the path, not the query string", () => {
      mockUseQuery.mockReturnValue({
        data: [applicationView],
        isFetched: true,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      act(() => {
        result.current.handleViewClick("app-view");
      });

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      const pushArgs = mockRouterPush.mock.calls[0]!;
      const urlObj = pushArgs[0] as {
        pathname: string;
        query: Record<string, unknown>;
      };

      // Must include pathname
      expect(urlObj.pathname).toBe("/[project]/messages");

      // "project" is in the query for Next.js dynamic route resolution,
      // but Next.js will NOT put it in the actual URL because pathname has [project]
      expect(urlObj.query.project).toBe("test-project");

      // The filter must be in the query
      expect(urlObj.query.origin).toEqual(["application"]);
    });
  });

  describe("when clicking all-traces to reset filters", () => {
    it("calls router.push with pathname for the reset", () => {
      mockUseQuery.mockReturnValue({
        data: [applicationView],
        isFetched: true,
      });

      const { result } = renderHook(() => useSavedViews(), { wrapper });

      // Select a view first
      act(() => {
        result.current.handleViewClick("app-view");
      });

      mockRouterPush.mockClear();

      // Now click all-traces to reset
      act(() => {
        result.current.handleViewClick("all-traces");
      });

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      const pushArgs = mockRouterPush.mock.calls[0]!;
      const urlObj = pushArgs[0] as {
        pathname: string;
        query: Record<string, unknown>;
      };

      expect(urlObj.pathname).toBe("/[project]/messages");
    });
  });

  describe("when restoring a saved view on page load", () => {
    it("calls router.push with pathname during restore", async () => {
      localStorage.setItem(selectedKey("test-project"), "app-view");
      localStorage.setItem(
        cacheKey("test-project"),
        JSON.stringify([applicationView]),
      );

      mockUseQuery.mockReturnValue({
        data: undefined,
        isFetched: false,
      });

      const { rerender } = renderHook(() => useSavedViews(), { wrapper });

      // Trigger initialization by resolving tRPC
      mockUseQuery.mockReturnValue({
        data: [applicationView],
        isFetched: true,
      });
      rerender();

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalled();
      });

      const pushArgs = mockRouterPush.mock.calls[0]!;
      const urlObj = pushArgs[0] as {
        pathname: string;
        query: Record<string, unknown>;
      };

      expect(urlObj.pathname).toBe("/[project]/messages");
      expect(urlObj.query.origin).toEqual(["application"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Full restore flow: proves the entire lifecycle
// ---------------------------------------------------------------------------

describe("useSavedViews() full restore lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRouterQuery = { project: "test-project" };
    mockRouterAsPath = "/test-project/messages";
    simulateRouterPush();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("restores view selection and applies filters to URL", async () => {
    // 1. User previously selected "app-view" — stored in localStorage
    localStorage.setItem(selectedKey("test-project"), "app-view");
    localStorage.setItem(
      cacheKey("test-project"),
      JSON.stringify([applicationView]),
    );

    // 2. Page loads — tRPC not yet resolved
    mockUseQuery.mockReturnValue({
      data: undefined,
      isFetched: false,
    });

    const { result, rerender } = renderHook(() => useSavedViews(), {
      wrapper,
    });

    // 3. selectedViewId is restored synchronously from localStorage
    expect(result.current.selectedViewId).toBe("app-view");

    // 4. After effects fire, router.push syncs URL
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalled();
    });

    // 5. Verify router.push was called with correct args
    const pushArgs = mockRouterPush.mock.calls[0]!;
    const urlObj = pushArgs[0] as {
      pathname: string;
      query: Record<string, unknown>;
    };

    expect(urlObj.pathname).toBe("/[project]/messages");
    expect(urlObj.query.origin).toEqual(["application"]);

    // 6. selectedViewId persists correctly
    expect(result.current.selectedViewId).toBe("app-view");
    expect(localStorage.getItem(selectedKey("test-project"))).toBe("app-view");
  });

  it("handles view click → stores selection for next visit", () => {
    mockUseQuery.mockReturnValue({
      data: [applicationView],
      isFetched: true,
    });

    const { result } = renderHook(() => useSavedViews(), { wrapper });

    // 1. User clicks "Application" view
    act(() => {
      result.current.handleViewClick("app-view");
    });

    // 2. Verify selection is stored
    expect(localStorage.getItem(selectedKey("test-project"))).toBe("app-view");

    // 3. Verify router.push was called with filters + pathname
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const pushArgs = mockRouterPush.mock.calls[0]!;
    const urlObj = pushArgs[0] as {
      pathname: string;
      query: Record<string, unknown>;
    };
    expect(urlObj.query.origin).toEqual(["application"]);
    expect(urlObj.pathname).toBe("/[project]/messages");
  });

  it("resets filters when toggling off a view", () => {
    mockUseQuery.mockReturnValue({
      data: [applicationView],
      isFetched: true,
    });

    const { result } = renderHook(() => useSavedViews(), { wrapper });

    // Select a view
    act(() => {
      result.current.handleViewClick("app-view");
    });

    mockRouterPush.mockClear();

    // Click same view again to deselect
    act(() => {
      result.current.handleViewClick("app-view");
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const pushArgs = mockRouterPush.mock.calls[0]!;
    const urlObj = pushArgs[0] as {
      pathname: string;
      query: Record<string, unknown>;
    };

    // Reset should NOT have origin filter
    expect(urlObj.query.origin).toBeUndefined();
    expect(urlObj.pathname).toBe("/[project]/messages");

    expect(result.current.selectedViewId).toBe("all-traces");
    expect(localStorage.getItem(selectedKey("test-project"))).toBe(
      "all-traces",
    );
  });
});
