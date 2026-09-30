/**
 * @vitest-environment jsdom
 *
 * `useFilteredTraceFacets` asks `tracesV2.facets` for the sidebar's counts
 * under the same input the list reads: the debounced query and the exact
 * window with its live flag. See specs/traces-v2/search.feature ("Facet
 * count updates").
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(),
  projectId: { value: "proj-1" as string | undefined },
  filter: {
    debouncedQueryText: "status:error",
    debouncedTimeRange: {
      from: 10,
      to: 20,
      label: "Last 1 hour" as string | undefined,
    },
  },
  samplePreview: { value: false },
}));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { facets: { useQuery: harness.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: harness.projectId.value
      ? { id: harness.projectId.value }
      : undefined,
  }),
}));

vi.mock("../../stores/explorerStore", () => ({
  useExplorerStore: (selector: (s: unknown) => unknown) =>
    selector(harness.filter),
}));

vi.mock("../../onboarding/hooks/usePreviewTracesActive", () => ({
  usePreviewTracesActive: () => harness.samplePreview.value,
}));

import { useFilteredTraceFacets } from "../useFilteredTraceFacets";

const lastInput = () => harness.useQuery.mock.calls.at(-1)?.[0];
const lastOpts = () => harness.useQuery.mock.calls.at(-1)?.[1];

beforeEach(() => {
  harness.useQuery.mockReset();
  harness.useQuery.mockImplementation(() => ({
    data: { facets: [] },
    isPlaceholderData: false,
    isFetching: false,
    isError: false,
  }));
  harness.projectId.value = "proj-1";
  harness.samplePreview.value = false;
  harness.filter.debouncedQueryText = "status:error";
  harness.filter.debouncedTimeRange = {
    from: 10,
    to: 20,
    label: "Last 1 hour",
  };
});

afterEach(() => vi.clearAllMocks());

describe("useFilteredTraceFacets", () => {
  describe("given a query and a live preset window", () => {
    /** @scenario "Facet counts update when a filter is applied" */
    it("asks for the counts under the active query in the exact window", () => {
      renderHook(() => useFilteredTraceFacets());
      expect(lastInput()).toEqual({
        projectId: "proj-1",
        timeRange: { from: 10, to: 20, live: true },
        query: "status:error",
      });
      expect(lastOpts()?.enabled).toBe(true);
    });

    /** @scenario "Facet counts are cached only per query and window" */
    it("asks under a different input when the query or the window changes, so no cached count can answer for it", () => {
      const { rerender } = renderHook(() => useFilteredTraceFacets());
      const first = lastInput();

      harness.filter.debouncedQueryText = "status:ok";
      rerender();
      const afterQuery = lastInput();
      expect(afterQuery).not.toEqual(first);
      expect(afterQuery).toMatchObject({ query: "status:ok" });

      harness.filter.debouncedTimeRange = {
        from: 30,
        to: 40,
        label: "Last 24h",
      };
      rerender();
      const afterWindow = lastInput();
      expect(afterWindow).not.toEqual(afterQuery);
      expect(afterWindow).toMatchObject({ timeRange: { from: 30, to: 40 } });

      // The input is the whole cache key, so a count for one input is never
      // read for another; the freshness window only says how long the count
      // for THIS input stands without a refetch.
      expect(lastOpts()?.staleTime).toBe(60_000);
    });
  });

  describe("given an absolute window and no query", () => {
    it("sends the window as not live and no query", () => {
      harness.filter.debouncedQueryText = "";
      harness.filter.debouncedTimeRange = {
        from: 10,
        to: 20,
        label: undefined,
      };
      renderHook(() => useFilteredTraceFacets());
      expect(lastInput()).toEqual({
        projectId: "proj-1",
        timeRange: { from: 10, to: 20, live: false },
        query: undefined,
      });
    });
  });

  describe("given the sample preview", () => {
    it("does not query at all", () => {
      harness.samplePreview.value = true;
      renderHook(() => useFilteredTraceFacets());
      expect(lastOpts()?.enabled).toBe(false);
    });
  });

  describe("given no project", () => {
    it("does not query at all", () => {
      harness.projectId.value = undefined;
      renderHook(() => useFilteredTraceFacets());
      expect(lastOpts()?.enabled).toBe(false);
    });
  });

  it("hands back the descriptors and the placeholder flag", () => {
    harness.useQuery.mockImplementation(() => ({
      data: { facets: [{ kind: "categorical", key: "status" }] },
      isPlaceholderData: true,
      isFetching: true,
      isError: false,
    }));
    const { result } = renderHook(() => useFilteredTraceFacets());
    expect(result.current).toEqual({
      data: [{ kind: "categorical", key: "status" }],
      isPlaceholderData: true,
      isFetching: true,
      isError: false,
    });
  });
});
