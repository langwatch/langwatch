/**
 * @vitest-environment jsdom
 *
 * The runs behind the query's `eval` chips ride with every read, the counts
 * read the judging run's counters, and a poll that moves refetches the table.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A registered run is
 * sent with every read the Explorer makes", "The header count reads the run's
 * counters during a run", "Matches appear as pages finish", "Stop cancels the
 * run and keeps the chip as partial").
 */
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  list: vi.fn(),
  facets: vi.fn(),
  newCount: vi.fn(),
  sessions: vi.fn(),
  invalidate: { list: vi.fn(), sessions: vi.fn(), facets: vi.fn() },
  getResults: [] as { data: unknown }[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      list: { useQuery: harness.list },
      facets: { useQuery: harness.facets },
      newCount: { useQuery: harness.newCount },
      sessions: { useQuery: harness.sessions },
    },
    useUtils: () => ({
      tracesV2: {
        list: { invalidate: harness.invalidate.list },
        sessions: { invalidate: harness.invalidate.sessions },
        facets: { invalidate: harness.invalidate.facets },
      },
    }),
    useQueries: () => harness.getResults,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("~/hooks/usePageVisibility", () => ({ usePageVisibility: () => true }));
vi.mock("../useTraceListRefresh", () => ({
  useTraceListRefresh: () => ({
    refresh: vi.fn(),
    isRefreshing: false,
    shouldSpin: false,
  }),
}));
vi.mock("../../onboarding", () => ({ useSamplePreview: () => null }));
vi.mock("../../onboarding/hooks/usePreviewTracesActive", () => ({
  usePreviewTracesActive: () => false,
}));

import { instantEvalRunKey } from "~/server/app-layer/traces/query-language/instantEvalChips";
import { instantEvalChipMark } from "../../components/SearchBar/SearchBar";
import { useFilterStore } from "../../stores/filterStore";
import { useInstantEvalRunStore } from "../../stores/instantEvalRunStore";
import { useViewStore } from "../../stores/viewStore";
import { useExplorerCounts } from "../useExplorerCounts";
import { useFilteredTraceFacets } from "../useFilteredTraceFacets";
import { useInstantEvalRunWatch } from "../useInstantEvalRunWatch";
import { useTraceListQuery } from "../useTraceListQuery";
import { useTraceNewCount } from "../useTraceNewCount";

const settled = (data: unknown) => ({
  data,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isFetched: true,
  isError: false,
  error: null,
});

const key = instantEvalRunKey({
  question: "the user is annoyed",
  target: "traces",
  otherQuery: "service:api",
  window: { from: 1_000, to: 2_000 },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.list.mockImplementation(() => settled({ items: [], totalHits: 3 }));
  harness.facets.mockImplementation(() => settled({ facets: [] }));
  harness.newCount.mockImplementation(() => settled({ count: 0 }));
  harness.sessions.mockImplementation(() =>
    settled({ sessions: [], totalHits: 0 }),
  );
  harness.getResults = [];
  useFilterStore.getState().clearAll();
  useFilterStore.setState({
    debouncedQueryText: 'service:api AND eval:"the user is annoyed"',
    debouncedTimeRange: { from: 1_000, to: 2_000 },
    evalRuns: { [key]: "run-1" },
  });
  useViewStore.setState({ activeLensId: "all-traces", grouping: "flat" });
  useInstantEvalRunStore.setState({ runs: {}, stoppedByUser: {} });
});

const expectedEvalRuns = {
  [key]: { question: "the user is annoyed", target: "traces", runId: "run-1" },
};

describe("given a chip with a registered run", () => {
  describe("when the list, the facets and the new count are read", () => {
    /** @scenario "A registered run is sent with every read the Explorer makes" */
    it("carries evalRuns with the question, the target and the run id", () => {
      renderHook(() => useTraceListQuery());
      renderHook(() => useFilteredTraceFacets());
      renderHook(() => useTraceNewCount());
      expect(harness.list.mock.calls.at(-1)?.[0]).toMatchObject({
        evalRuns: expectedEvalRuns,
      });
      expect(harness.facets.mock.calls.at(-1)?.[0]).toMatchObject({
        evalRuns: expectedEvalRuns,
      });
      expect(harness.newCount.mock.calls.at(-1)?.[0]).toMatchObject({
        evalRuns: expectedEvalRuns,
      });
    });
  });

  describe("when the chip has no run under its key", () => {
    /** @scenario "A chip with no registered run is pending" */
    it("sends no evalRuns and marks the chip pending", () => {
      useFilterStore.setState({ evalRuns: {} });
      renderHook(() => useTraceListQuery());
      expect(harness.list.mock.calls.at(-1)?.[0]).not.toHaveProperty(
        "evalRuns",
      );
      expect(instantEvalChipMark({ run: undefined, hasRun: false })).toBe(
        "(pending)",
      );
    });
  });
});

describe("given a run with total 10,000, progress 3,200 and 412 matched", () => {
  describe("when the explorer counts are read", () => {
    /** @scenario "The header count reads the run's counters during a run" */
    it("reads the run's counters while it judges and the plain count after", () => {
      useInstantEvalRunStore.getState().setRun({
        id: "run-1",
        status: "running",
        total: 10_000,
        progress: 3_200,
        matched: 412,
        failed: 0,
        skipped: 0,
        error: null,
        priceUsd: 0.3,
      });
      const { result, rerender } = renderHook(() => useExplorerCounts());
      expect(result.current.summary).toBe(
        "412 matched so far · 3,200 of 10,000 judged",
      );
      expect(result.current.instantEval).toEqual({
        runId: "run-1",
        judged: 3_200,
        total: 10_000,
        matched: 412,
      });
      act(() =>
        useInstantEvalRunStore.getState().setRun({
          id: "run-1",
          status: "finished",
          total: 10_000,
          progress: 10_000,
          matched: 900,
          failed: 0,
          skipped: 0,
          error: null,
          priceUsd: 0.9,
        }),
      );
      rerender();
      expect(result.current.instantEval).toBeNull();
      expect(result.current.summary).toBe("3 traces");
    });
  });
});

describe("given a run whose progress moves", () => {
  describe("when the poll reports the new progress", () => {
    /** @scenario "Matches appear as pages finish" */
    it("refetches the list and the facets", () => {
      const run = (progress: number) => ({
        data: {
          id: "run-1",
          status: "running",
          total: 10_000,
          progress,
          matched: 12,
          failed: 0,
          skipped: 0,
          error: null,
          priceUsd: 0.1,
        },
      });
      harness.getResults = [run(1_000)];
      const { rerender } = renderHook(() => useInstantEvalRunWatch());
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);
      harness.getResults = [run(2_000)];
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(2);
    });
  });
});

describe("given a run stopped short of its total", () => {
  describe("when the chip is marked", () => {
    /** @scenario "Stop cancels the run and keeps the chip as partial" */
    it("reads partial, naming judged versus total", () => {
      expect(
        instantEvalChipMark({
          run: { status: "cancelled", progress: 3_200, total: 10_000 },
          hasRun: true,
        }),
      ).toBe("(partial: 3,200 of 10,000 judged)");
      expect(
        instantEvalChipMark({
          run: { status: "finished", progress: 10_000, total: 10_000 },
          hasRun: true,
        }),
      ).toBeNull();
      expect(
        instantEvalChipMark({
          run: { status: "running", progress: 10, total: 10_000 },
          hasRun: true,
        }),
      ).toBeNull();
    });
  });
});
