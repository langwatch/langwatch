/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeScenarioRunData } from "./run-history-fixtures.ts";

type Page =
  | { changed: false; lastUpdatedAt: number }
  | {
      changed: true;
      lastUpdatedAt: number;
      runs: ReturnType<typeof makeScenarioRunData>[];
      scenarioSetIds: Record<string, string>;
      hasMore: boolean;
      nextCursor?: string;
    };

type Options = { getNextPageParam: (last: Page) => string | undefined };

const state = vi.hoisted(() => ({
  pages: [] as unknown[],
  hasNextPage: false,
  input: undefined as unknown,
  options: undefined as unknown,
  fetchNextPage: vi.fn(),
  freshness: vi.fn(),
}));

vi.mock("../../scenario-api.ts", () => ({
  api: {},
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: {
      getSuiteRunData: {
        useInfiniteQuery: (input: unknown, options: unknown) => {
          state.input = input;
          state.options = options;
          return {
            data: { pages: state.pages },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
            hasNextPage: state.hasNextPage,
            isFetchingNextPage: false,
            fetchNextPage: state.fetchNextPage,
          };
        },
      },
    },
  },
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1" } }),
}));
vi.mock("../use-suite-run-freshness.ts", () => ({
  useSuiteRunFreshness: (args: unknown) => state.freshness(args),
}));

import { useRunHistoryPagination } from "../use-run-history-pagination.ts";

const changedPage = (ids: string[], more: { nextCursor?: string } = {}): Page => ({
  changed: true,
  lastUpdatedAt: 1,
  runs: ids.map((id) => makeScenarioRunData({ scenarioRunId: id })),
  scenarioSetIds: Object.fromEntries(ids.map((id) => [id, `set_${id}`])),
  hasMore: more.nextCursor !== undefined,
  ...more,
});

describe("useRunHistoryPagination", () => {
  beforeEach(() => {
    state.pages = [];
    state.hasNextPage = false;
    state.fetchNextPage.mockReset();
    state.freshness.mockReset();
  });

  describe("when the first page arrives", () => {
    it("returns its runs and scenario set ids and sends no cursor", () => {
      state.pages = [changedPage(["a", "b"], { nextCursor: "c1" })];
      state.hasNextPage = true;

      const { result } = renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));

      expect(result.current.allRuns.map((r) => r.scenarioRunId)).toEqual(["a", "b"]);
      expect(result.current.allScenarioSetIds).toEqual({ a: "set_a", b: "set_b" });
      expect(result.current.hasMore).toBe(true);
      expect(state.input).toEqual({
        projectId: "proj_1",
        scenarioSetId: undefined,
        limit: 20,
        startDate: 100,
      });
    });

    it("keeps the freshness probe on while one page is loaded", () => {
      state.pages = [changedPage(["a"])];

      renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));

      expect(state.freshness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    });
  });

  describe("when more pages are loaded", () => {
    it("appends their runs in order and stops the freshness probe", () => {
      state.pages = [changedPage(["a"], { nextCursor: "c1" }), changedPage(["b"])];

      const { result } = renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));

      expect(result.current.allRuns.map((r) => r.scenarioRunId)).toEqual(["a", "b"]);
      expect(result.current.hasMore).toBe(false);
      expect(state.freshness).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    });

    it("asks for the next page on loadMore only when there is one", () => {
      state.pages = [changedPage(["a"], { nextCursor: "c1" })];
      state.hasNextPage = true;
      const { result, rerender } = renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));

      act(() => result.current.loadMore());
      expect(state.fetchNextPage).toHaveBeenCalledTimes(1);

      state.hasNextPage = false;
      rerender();
      act(() => result.current.loadMore());
      expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
    });

    it("derives the next cursor from the last page", () => {
      renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));
      const { getNextPageParam } = state.options as Options;

      expect(getNextPageParam(changedPage(["a"], { nextCursor: "c1" }))).toBe("c1");
      expect(getNextPageParam(changedPage(["a"]))).toBeUndefined();
      expect(getNextPageParam({ changed: false, lastUpdatedAt: 1 })).toBeUndefined();
    });
  });

  describe("when the period changes", () => {
    it("keys the query on the new start date, which resets the pages", () => {
      const { rerender } = renderHook(
        ({ startDateMs }) => useRunHistoryPagination({ startDateMs }),
        { initialProps: { startDateMs: 100 } },
      );
      rerender({ startDateMs: 200 });

      expect(state.input).toMatchObject({ startDate: 200 });
      expect(state.input).not.toHaveProperty("cursor");
    });
  });

  describe("when an answer is unchanged", () => {
    it("skips it and keeps the runs of the pages that carry them", () => {
      state.pages = [
        changedPage(["a"], { nextCursor: "c1" }),
        { changed: false, lastUpdatedAt: 2 },
      ];

      const { result } = renderHook(() => useRunHistoryPagination({ startDateMs: 100 }));

      expect(result.current.allRuns.map((r) => r.scenarioRunId)).toEqual(["a"]);
    });
  });
});
