/**
 * @vitest-environment jsdom
 *
 * Every saved-view change on the analytics bar is optimistic: the cached
 * list is edited before the server answers. When the server refuses (an
 * aggregate project, a lost permission, a network fault), the user must be
 * told, and the list must be read again so the edit does not stick on
 * screen as if it had been kept.
 *
 * @see specs/traces/saved-views.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MutationName = "create" | "rename" | "delete" | "reorder";

interface DbView {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  query: string | null;
  period: unknown;
}

type MutateOptions = { onError?: (error: unknown) => void };

const { mutationFor, invalidate, setData, toast, cache, filterParams } =
  vi.hoisted(() => {
    const refusal = new Error("aggregate_project_is_read_only");
    const options: Partial<Record<string, MutateOptions>> = {};
    // The server refuses every write: the hook's own handler runs first, then
    // the one passed to the single call, as react-query orders them.
    const mutationFor = (name: string) => ({
      useMutation: (hookOptions: MutateOptions) => {
        options[name] = hookOptions;
        return {
          mutate: (_input: unknown, callOptions?: MutateOptions) => {
            options[name]?.onError?.(refusal);
            callOptions?.onError?.(refusal);
          },
        };
      },
    });
    // The query cache the hook edits optimistically, so a rollback is
    // visible in what the hook renders next.
    const cache: { views: DbView[] } = { views: [] };
    return {
      mutationFor,
      invalidate: vi.fn(),
      setData: vi.fn(
        (
          _key: unknown,
          updater: (old: DbView[] | undefined) => DbView[] | undefined,
        ) => {
          cache.views = updater(cache.views) ?? [];
        },
      ),
      toast: vi.fn<(args: { title?: string; type?: string }) => void>(),
      cache,
      filterParams: { filters: {} as Record<string, unknown> },
    };
  });

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn().mockResolvedValue(true),
    pathname: "/[project]/analytics",
    asPath: "/[project]/analytics",
  }),
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "test-project" } }),
}));

vi.mock("../useFilterParams", () => ({
  useFilterParams: () => filterParams,
}));

// The toast goes through the real `showErrorToast`, so the title asserted is
// the one the user reads: a refusal with no code falls back to the change's own.
vi.mock("~/components/ui/toaster", () => ({ toaster: { create: toast } }));

vi.mock("../../utils/api", () => ({
  api: {
    savedViews: {
      getAll: {
        useQuery: () => ({ data: cache.views, isFetched: true }),
      },
      create: mutationFor("create"),
      rename: mutationFor("rename"),
      delete: mutationFor("delete"),
      reorder: mutationFor("reorder"),
    },
    useUtils: () => ({ savedViews: { getAll: { invalidate, setData } } }),
  },
}));

import { SavedViewsProvider, useSavedViews } from "../useSavedViews";

function wrapper({ children }: { children: React.ReactNode }) {
  return <SavedViewsProvider>{children}</SavedViewsProvider>;
}

type Views = ReturnType<typeof useSavedViews>;

const changes: Array<{
  mutation: MutationName;
  fallbackTitle: string;
  act: (views: Views) => void;
}> = [
  {
    mutation: "create",
    fallbackTitle: "Couldn't save the view",
    act: (views) => {
      views.saveView("New View");
    },
  },
  {
    mutation: "rename",
    fallbackTitle: "Couldn't rename the view",
    act: (views) => views.renameView("view-1", "Renamed"),
  },
  {
    mutation: "delete",
    fallbackTitle: "Couldn't delete the view",
    act: (views) => views.deleteView("view-1"),
  },
  {
    mutation: "reorder",
    fallbackTitle: "Couldn't reorder the views",
    act: (views) => views.reorderViews([...views.customViews].reverse()),
  },
];

const serverViews: DbView[] = [
  { id: "view-1", name: "Old View", filters: {}, query: null, period: null },
  {
    id: "view-2",
    name: "Other View",
    filters: {},
    query: null,
    period: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  cache.views = [...serverViews];
  filterParams.filters = {};
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useSavedViews()", () => {
  describe.each(changes)("given the server refuses a $mutation", (change) => {
    describe("when the user makes the change", () => {
      /** @scenario "A saved-view change the server refuses is rolled back" */
      it("shows an error toast and reloads the views from the server", () => {
        const { result } = renderHook(() => useSavedViews(), { wrapper });

        act(() => change.act(result.current));

        expect(setData).toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: change.fallbackTitle,
            type: "error",
          }),
        );
        expect(invalidate).toHaveBeenCalledWith({ projectId: "test-project" });
      });
    });
  });

  describe("given the user has filters on that match no saved view", () => {
    beforeEach(() => {
      filterParams.filters = { "traces.error": ["true"] };
    });

    describe("when the server refuses to save them as a view", () => {
      /** @scenario "A refused saved-view create leaves no temporary view selected" */
      it("removes the temporary view and selects nothing", () => {
        const { result } = renderHook(() => useSavedViews(), { wrapper });

        act(() => {
          result.current.saveView("New View");
        });

        expect(result.current.customViews.map((view) => view.id)).toEqual([
          "view-1",
          "view-2",
        ]);
        expect(result.current.selectedViewId).toBeNull();
      });
    });
  });
});
