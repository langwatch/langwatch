/**
 * @vitest-environment jsdom
 * Every saved-view change is optimistic. When the server refuses it (an aggregate project, a
 * lost permission, a network fault) the user is told and the list is read again, so the edit
 * does not stick on screen as if it had been kept.
 * @see specs/traces/saved-views.feature
 */

import type { UiFailureNotice } from "@langwatch/browser-host/capabilities";
import { setUiFeedbackHost } from "@langwatch/browser-host/toaster";
import { act, cleanup, renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbView = { id: string; name: string; filters: Record<string, unknown>; query: null };
type MutateOptions = { onError?: (error: unknown) => void };

const { mutationFor, invalidate, setData, cache, filterParams } = vi.hoisted(() => {
  const refusal = new Error("This project reads traces from other projects");
  // The hook's own handler runs first, then the one passed to the single call, as react-query
  // orders them.
  const mutationFor = () => ({
    useMutation: (hookOptions: MutateOptions) => ({
      mutate: (_input: unknown, callOptions?: MutateOptions) => {
        hookOptions.onError?.(refusal);
        callOptions?.onError?.(refusal);
      },
    }),
  });
  const cache: { views: DbView[] } = { views: [] };
  return {
    mutationFor,
    invalidate: vi.fn(),
    setData: vi.fn(
      (_key: unknown, updater: (old: DbView[] | undefined) => DbView[] | undefined) => {
        cache.views = updater(cache.views) ?? [];
      },
    ),
    cache,
    filterParams: { filters: {} as Record<string, unknown> },
  };
});

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn().mockResolvedValue(true), pathname: "/x/analytics" }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "test-project" } }),
}));
vi.mock("../use-filter-params.ts", () => ({ useFilterParams: () => filterParams }));
vi.mock("../analytics-api.ts", () => ({
  analyticsApi: {
    savedViews: {
      getAll: { useQuery: () => ({ data: cache.views, isFetched: true }) },
      create: mutationFor(),
      rename: mutationFor(),
      delete: mutationFor(),
      reorder: mutationFor(),
    },
    useUtils: () => ({ savedViews: { getAll: { invalidate, setData } } }),
  },
}));

import { SavedViewsProvider, useSavedViews } from "../use-saved-views.tsx";

type Views = ReturnType<typeof useSavedViews>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <SavedViewsProvider>{children}</SavedViewsProvider>;
}

const changes: { mutation: string; fallbackTitle: string; act: (views: Views) => void }[] = [
  {
    mutation: "create",
    fallbackTitle: "Couldn't save the view",
    act: (v) => void v.saveView("New View"),
  },
  {
    mutation: "rename",
    fallbackTitle: "Couldn't rename the view",
    act: (v) => v.renameView("view-1", "Renamed"),
  },
  {
    mutation: "delete",
    fallbackTitle: "Couldn't delete the view",
    act: (v) => v.deleteView("view-1"),
  },
  {
    mutation: "reorder",
    fallbackTitle: "Couldn't reorder the views",
    act: (v) => v.reorderViews([...v.customViews].reverse()),
  },
];

let failed: UiFailureNotice[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  failed = [];
  setUiFeedbackHost({ succeeded: () => {}, failed: (notice) => void failed.push(notice) });
  cache.views = [
    { id: "view-1", name: "Old View", filters: {}, query: null },
    { id: "view-2", name: "Other View", filters: {}, query: null },
  ];
  filterParams.filters = {};
});

afterEach(() => {
  cleanup();
  setUiFeedbackHost(void 0);
});

describe("useSavedViews()", () => {
  describe.each(changes)("given the server refuses a $mutation", (change) => {
    /** @scenario "A saved-view change the server refuses is rolled back" */
    it("shows an error toast and reloads the views from the server", () => {
      const { result } = renderHook(() => useSavedViews(), { wrapper });

      act(() => change.act(result.current));

      expect(setData).toHaveBeenCalled();
      expect(failed.map((notice) => notice.fallbackTitle)).toContain(change.fallbackTitle);
      expect(invalidate).toHaveBeenCalledWith({ projectId: "test-project" });
    });
  });

  describe("given filters that match no saved view, when the server refuses to save them", () => {
    /** @scenario "A refused saved-view create leaves no temporary view selected" */
    it("removes the temporary view and selects nothing", () => {
      filterParams.filters = { "traces.error": ["true"] };
      const { result } = renderHook(() => useSavedViews(), { wrapper });

      act(() => void result.current.saveView("New View"));

      expect(result.current.customViews.map((view) => view.id)).toEqual(["view-1", "view-2"]);
      expect(result.current.selectedViewId).toBeNull();
    });
  });
});
