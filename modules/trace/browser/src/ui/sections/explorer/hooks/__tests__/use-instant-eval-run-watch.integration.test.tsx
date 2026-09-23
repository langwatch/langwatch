/**
 * @vitest-environment jsdom
 *
 * The runs behind the query's `eval` chips ride with every read, the counts
 * read the judging run's counters, and a poll that moves refetches the table.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { instantEvalRunKey } from "@langwatch/trace-contract";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  list: vi.fn(),
  discover: vi.fn(),
  newCount: vi.fn(),
  sessions: vi.fn(),
  invalidate: { list: vi.fn(), sessions: vi.fn(), facetValues: vi.fn(), newCount: vi.fn() },
  getResults: [] as { data: unknown; dataUpdatedAt: number }[],
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    traces: {
      list: { useQuery: harness.list },
      discover: { useQuery: harness.discover },
      newCount: { useQuery: harness.newCount },
      sessions: { useQuery: harness.sessions },
      instantEvalGet: (input: unknown) => input,
    },
    useUtils: () => ({
      traces: {
        list: { invalidate: harness.invalidate.list },
        sessions: { invalidate: harness.invalidate.sessions },
        facetValues: { invalidate: harness.invalidate.facetValues },
        newCount: { invalidate: harness.invalidate.newCount },
      },
    }),
    useQueries: () => harness.getResults,
  },
}));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("../../../../../behavior/explorer/onboarding/use-preview-traces-active.ts", () => ({
  usePreviewTracesActive: () => false,
}));
vi.mock("../../onboarding/index.ts", () => ({ useSamplePreview: () => null }));
vi.mock("../use-trace-list-refresh.ts", () => ({
  useTraceListRefresh: () => ({ refresh: vi.fn(), isRefreshing: false, shouldSpin: false }),
}));

import { useInstantEvalRunStore } from "../../../../../behavior/instant-eval-run.store.ts";
import { instantEvalProgressCopy } from "../../../../elements/explorer/instant-eval-progress.tsx";
import { useExplorerCounts } from "../use-explorer-counts.ts";
import { useFilteredTraceFacets } from "../use-filtered-trace-facets.ts";
import { useInstantEvalRunWatch } from "../use-instant-eval-run-watch.ts";
import { useTraceListQuery } from "../use-trace-list-query.ts";
import { useTraceNewCount } from "../use-trace-new-count.ts";

const settled = (data: unknown) => ({
  data,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isFetched: true,
  isError: false,
  error: null,
  dataUpdatedAt: 1,
  errorUpdatedAt: 0,
});

const key = instantEvalRunKey({
  question: "the user is annoyed",
  target: "traces",
  otherQuery: "service:api",
  window: { from: 1_000, to: 2_000 },
});

type RunStatus = "running" | "finished" | "cancelled";

function progress({
  status = "running",
  total = 10_000,
  progress: judged,
  matched,
  finishedAtMs = status === "running" ? null : Date.now(),
}: {
  status?: RunStatus;
  total?: number;
  progress: number;
  matched: number;
  finishedAtMs?: number | null;
}) {
  return {
    id: "run-1",
    status,
    total,
    progress: judged,
    matched,
    failed: 0,
    skipped: 0,
    error: null,
    priceUsd: 0.1,
    finishedAtMs,
  };
}

/** One poll answer, stamped so the watch counts a repeated answer once. */
let answeredAt = 0;
const answer = (run: ReturnType<typeof progress>) => {
  answeredAt += 1;
  return [{ data: run, dataUpdatedAt: answeredAt }];
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.list.mockImplementation(() => settled({ items: [], totalHits: 3 }));
  harness.discover.mockImplementation(() => settled({ facets: [] }));
  harness.newCount.mockImplementation(() => settled({ count: 0 }));
  harness.sessions.mockImplementation(() => settled({ sessions: [], totalHits: 0 }));
  harness.getResults = [];
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({
    debouncedQueryText: 'service:api AND eval:"the user is annoyed"',
    debouncedTimeRange: { from: 1_000, to: 2_000 },
    evalRuns: { [key]: "run-1" },
    activeLensId: "all-traces",
    grouping: "flat",
  });
  useInstantEvalRunStore.setState({ runs: {}, stoppedByUser: {}, quiet: {}, settled: {} });
});

afterEach(() => {
  vi.useRealTimers();
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

      expect(harness.list.mock.calls.at(-1)?.[0]).toMatchObject({ evalRuns: expectedEvalRuns });
      expect(harness.discover.mock.calls.at(-1)?.[0]).toMatchObject({
        evalRuns: expectedEvalRuns,
      });
      expect(harness.newCount.mock.calls.at(-1)?.[0]).toMatchObject({
        evalRuns: expectedEvalRuns,
      });
    });
  });

  describe("when the chip has no run under its key", () => {
    /** @scenario "A chip with no registered run is pending" */
    it("sends no evalRuns", () => {
      useExplorerStore.setState({ evalRuns: {} });

      renderHook(() => useTraceListQuery());

      expect(harness.list.mock.calls.at(-1)?.[0]).not.toHaveProperty("evalRuns");
    });
  });
});

describe("given a run with total 10,000, progress 3,200 and 412 matched", () => {
  describe("when the explorer counts are read", () => {
    /** @scenario "The header count reads the run's counters during a run" */
    it("reads the run's counters while it judges and the plain count after", () => {
      useInstantEvalRunStore.getState().setRun(progress({ progress: 3_200, matched: 412 }));
      const { result, rerender } = renderHook(() => useExplorerCounts());

      expect(result.current.summary).toBe("412 matched so far · 3,200 of 10,000 judged");
      expect(result.current.instantEval).toEqual({
        runId: "run-1",
        judged: 3_200,
        total: 10_000,
        matched: 412,
        phase: "judging",
      });

      act(() =>
        useInstantEvalRunStore
          .getState()
          .setRun(progress({ status: "finished", progress: 10_000, matched: 900 })),
      );
      rerender();
      expect(result.current.summary).toBe("900 matched so far · 10,000 of 10,000 judged");

      act(() => useInstantEvalRunStore.getState().markSettled("run-1"));
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
      harness.getResults = answer(progress({ progress: 1_000, matched: 12 }));

      renderHook(() => useInstantEvalRunWatch());

      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);
      expect(harness.invalidate.facetValues).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Matches appear as pages finish" */
    it("spaces the reads while the run judges, and leaves a read in flight alone", () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      harness.getResults = answer(progress({ progress: 1_000, matched: 12 }));
      const { rerender } = renderHook(() => useInstantEvalRunWatch());
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);

      vi.setSystemTime(101_000);
      harness.getResults = answer(progress({ progress: 2_000, matched: 12 }));
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);
      expect(harness.invalidate.facetValues).toHaveBeenCalledTimes(1);

      vi.setSystemTime(102_500);
      harness.getResults = answer(progress({ progress: 3_000, matched: 12 }));
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.list).toHaveBeenLastCalledWith(undefined, undefined, {
        cancelRefetch: false,
      });
      expect(harness.invalidate.facetValues).toHaveBeenCalledTimes(1);

      vi.setSystemTime(109_000);
      harness.getResults = answer(progress({ progress: 4_000, matched: 12 }));
      rerender();
      rerender();
      expect(harness.invalidate.facetValues).toHaveBeenCalledTimes(2);
    });

    /** @scenario "Matches appear as pages finish" */
    it("always reads both once more when the run ends", () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      harness.getResults = answer(progress({ progress: 9_000, matched: 12 }));
      const { rerender } = renderHook(() => useInstantEvalRunWatch());

      vi.setSystemTime(100_300);
      harness.getResults = answer(progress({ status: "finished", progress: 10_000, matched: 12 }));
      rerender();
      rerender();

      expect(harness.invalidate.list).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.facetValues).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.facetValues).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });
  });
});

describe("given a running run that was asked to stop", () => {
  const stopped = (input: { status: "running" | "cancelled"; progress: number; matched: number }) =>
    progress({ ...input, total: 1_354 });

  describe("when the run turns cancelled and its counters keep moving", () => {
    /** @scenario "A stopped run is read until its numbers hold still" */
    it("keeps the counts on the run's counters until a repeated read and the final list read", async () => {
      useInstantEvalRunStore.getState().markStopped("run-1");
      harness.getResults = answer(stopped({ status: "running", progress: 500, matched: 72 }));
      const watch = renderHook(() => useInstantEvalRunWatch());
      const counts = renderHook(() => useExplorerCounts());
      expect(counts.result.current.instantEval?.phase).toBe("stopping");
      expect(
        instantEvalProgressCopy({ judged: 500, total: 1_354, matched: 72, phase: "stopping" }),
      ).toBe("Stopping 500 / 1,354 · 72 matched");

      harness.getResults = answer(stopped({ status: "cancelled", progress: 540, matched: 80 }));
      watch.rerender();
      counts.rerender();
      expect(counts.result.current.instantEval?.phase).toBe("settling");
      expect(counts.result.current.summary).toBe("80 matched so far · 540 of 1,354 judged");

      harness.getResults = answer(stopped({ status: "cancelled", progress: 920, matched: 127 }));
      watch.rerender();
      counts.rerender();
      expect(counts.result.current.summary).toBe("127 matched so far · 920 of 1,354 judged");
      expect(useInstantEvalRunStore.getState().settled["run-1"]).toBeUndefined();

      // The same counters again: quiet, so the final read goes out.
      const listReadsBefore = harness.invalidate.list.mock.calls.length;
      harness.getResults = answer(stopped({ status: "cancelled", progress: 920, matched: 127 }));
      watch.rerender();
      expect(useInstantEvalRunStore.getState().quiet["run-1"]).toBe(true);
      expect(harness.invalidate.list.mock.calls.length).toBe(listReadsBefore + 1);
      await act(async () => {
        await Promise.resolve();
      });
      counts.rerender();
      expect(useInstantEvalRunStore.getState().settled["run-1"]).toBe(true);
      expect(counts.result.current.instantEval).toBeNull();
      expect(counts.result.current.summary).toBe("3 traces");
    });
  });

  describe("when a run that ended long ago is read for the first time", () => {
    /** @scenario "A run that ended long before the page opened is settled at once" */
    it("is settled without a second read", () => {
      useInstantEvalRunStore.getState().setRun(
        progress({
          status: "cancelled",
          total: 1_354,
          progress: 920,
          matched: 127,
          finishedAtMs: Date.now() - 60_000,
        }),
      );

      expect(useInstantEvalRunStore.getState().settled["run-1"]).toBe(true);
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current.instantEval).toBeNull();
    });
  });
});
