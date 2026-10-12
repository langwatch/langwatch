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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.resetModules());
vi.unmock("../useTraceListQuery");
vi.unmock("../useSessionGroups");
vi.unmock("../useInstantEvalRuns");
vi.unmock("../../stores/explorerStore");
vi.unmock("../../stores/instantEvalRunStore");

const harness = vi.hoisted(() => ({
  list: vi.fn(),
  facets: vi.fn(),
  newCount: vi.fn(),
  sessions: vi.fn(),
  invalidate: { list: vi.fn(), sessions: vi.fn(), facets: vi.fn() },
  getResults: [] as {
    data: unknown;
    isError?: boolean;
    dataUpdatedAt?: number;
  }[],
  getQuery: vi.fn(),
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
    useQueries: (
      queries: (t: {
        tracesV2: { instantEval: { get: typeof harness.getQuery } };
      }) => unknown,
    ) => {
      queries({ tracesV2: { instantEval: { get: harness.getQuery } } });
      return harness.getResults;
    },
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
import {
  instantEvalChipLabel,
  instantEvalChipMark,
  isInstantEvalBusy,
} from "../../components/SearchBar/SearchBar";
import { instantEvalProgressCopy } from "../../components/TracesPage/InstantEvalProgressBar";
import { emptyContent } from "../../components/TraceTable/EmptyFilterState";
import { useExplorerStore } from "../../stores/explorerStore";
import { useInstantEvalRunStore } from "../../stores/instantEvalRunStore";
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
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({
    debouncedQueryText: 'service:api AND eval:"the user is annoyed"',
    debouncedTimeRange: { from: 1_000, to: 2_000 },
    evalRuns: { [key]: "run-1" },
  });
  useExplorerStore.setState({ activeLensId: "all-traces", grouping: "flat" });
  useInstantEvalRunStore.setState({
    runs: {},
    stoppedByUser: {},
    readUnavailable: {},
    quiet: {},
    settled: {},
  });
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
      useExplorerStore.setState({ evalRuns: {} });
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
        finishedAtMs: null,
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
        phase: "judging",
      });
      const finished = {
        id: "run-1",
        status: "finished" as const,
        total: 10_000,
        progress: 10_000,
        matched: 900,
        failed: 0,
        skipped: 0,
        error: null,
        priceUsd: 0.9,
        finishedAtMs: Date.now(),
      };
      act(() => useInstantEvalRunStore.getState().setRun(finished));
      rerender();
      expect(result.current.summary).toBe(
        "900 matched so far · 10,000 of 10,000 judged",
      );
      act(() => useInstantEvalRunStore.getState().markSettled("run-1"));
      rerender();
      expect(result.current.instantEval).toBeNull();
      expect(result.current.summary).toBe("3 traces");
    });
  });
});

describe("given a run whose progress moves", () => {
  const run = ({
    progress,
    status = "running",
  }: {
    progress: number;
    status?: string;
  }) => ({
    data: {
      id: "run-1",
      status,
      total: 10_000,
      progress,
      matched: 12,
      failed: 0,
      skipped: 0,
      error: null,
      priceUsd: 0.1,
      finishedAtMs: status === "running" ? null : Date.now(),
    },
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the poll reports the new progress", () => {
    /** @scenario "Matches appear as pages finish" */
    it("refetches the list and the facets", () => {
      harness.getResults = [run({ progress: 1_000 })];
      renderHook(() => useInstantEvalRunWatch());
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Matches appear as pages finish" */
    it("spaces the reads while the run judges, and leaves a read in flight alone", () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      harness.getResults = [run({ progress: 1_000 })];
      const { rerender } = renderHook(() => useInstantEvalRunWatch());
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);

      vi.setSystemTime(101_000);
      harness.getResults = [run({ progress: 2_000 })];
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(1);
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(1);

      vi.setSystemTime(102_500);
      harness.getResults = [run({ progress: 3_000 })];
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.list).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        { cancelRefetch: false },
      );
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(1);

      vi.setSystemTime(109_000);
      harness.getResults = [run({ progress: 4_000 })];
      rerender();
      rerender();
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(2);
    });

    /** @scenario "Matches appear as pages finish" */
    it("always reads both once more when the run ends", () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      harness.getResults = [run({ progress: 9_000 })];
      const { rerender } = renderHook(() => useInstantEvalRunWatch());
      vi.setSystemTime(100_300);
      harness.getResults = [run({ progress: 10_000, status: "finished" })];
      rerender();
      rerender();
      expect(harness.invalidate.list).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.facets).toHaveBeenCalledTimes(2);
      expect(harness.invalidate.facets).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });
  });
});

describe("given a running run that was asked to stop", () => {
  const stopped = ({
    status,
    progress,
    matched,
  }: {
    status: "running" | "cancelled";
    progress: number;
    matched: number;
  }) => ({
    data: {
      id: "run-1",
      status,
      total: 1_354,
      progress,
      matched,
      failed: 0,
      skipped: 0,
      error: null,
      priceUsd: 0.1,
      finishedAtMs: status === "running" ? null : Date.now(),
    },
  });

  describe("when the run turns cancelled and its counters keep moving", () => {
    /** @scenario "A stopped run is read until its numbers hold still" */
    it("keeps the counts on the run's counters until a repeated read and the final list read", async () => {
      useInstantEvalRunStore.getState().markStopped("run-1");
      harness.getResults = [
        stopped({ status: "running", progress: 500, matched: 72 }),
      ];
      const watch = renderHook(() => useInstantEvalRunWatch());
      const counts = renderHook(() => useExplorerCounts());
      expect(counts.result.current.instantEval?.phase).toBe("stopping");
      expect(
        instantEvalProgressCopy({
          judged: 500,
          total: 1_354,
          matched: 72,
          phase: "stopping",
        }),
      ).toBe("Stopping 500 / 1,354 · 72 matched");

      // Terminal, but the page it held is still landing verdicts.
      harness.getResults = [
        stopped({ status: "cancelled", progress: 540, matched: 80 }),
      ];
      watch.rerender();
      counts.rerender();
      expect(counts.result.current.instantEval?.phase).toBe("settling");
      expect(counts.result.current.summary).toBe(
        "80 matched so far · 540 of 1,354 judged",
      );

      harness.getResults = [
        stopped({ status: "cancelled", progress: 920, matched: 127 }),
      ];
      watch.rerender();
      counts.rerender();
      expect(counts.result.current.summary).toBe(
        "127 matched so far · 920 of 1,354 judged",
      );
      expect(
        useInstantEvalRunStore.getState().settled["run-1"],
      ).toBeUndefined();

      // The same counters again: quiet, so the final read goes out.
      const listReadsBefore = harness.invalidate.list.mock.calls.length;
      harness.getResults = [
        stopped({ status: "cancelled", progress: 920, matched: 127 }),
      ];
      watch.rerender();
      expect(useInstantEvalRunStore.getState().quiet["run-1"]).toBe(true);
      expect(harness.invalidate.list.mock.calls.length).toBe(
        listReadsBefore + 1,
      );
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
      useInstantEvalRunStore.getState().setRun({
        id: "run-1",
        status: "cancelled",
        total: 1_354,
        progress: 920,
        matched: 127,
        failed: 0,
        skipped: 0,
        error: null,
        priceUsd: 0.1,
        finishedAtMs: Date.now() - 60_000,
      });
      expect(useInstantEvalRunStore.getState().settled["run-1"]).toBe(true);
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current.instantEval).toBeNull();
    });
  });
});

describe("given an eval chip in the search bar", () => {
  const chips = [{ runId: "run-1" }];
  const idle = { isEstimating: false, isStarting: false };

  describe("when its run is estimated, started, queued, planned or judged", () => {
    /** @scenario "An eval chip sweeps while its run is under way" */
    it("reports the chip busy", () => {
      expect(
        isInstantEvalBusy({ ...idle, isEstimating: true, chips: [], runs: {} }),
      ).toBe(true);
      expect(
        isInstantEvalBusy({ ...idle, isStarting: true, chips: [], runs: {} }),
      ).toBe(true);
      for (const status of ["queued", "planning", "running"] as const) {
        expect(
          isInstantEvalBusy({ ...idle, chips, runs: { "run-1": { status } } }),
        ).toBe(true);
      }
    });
  });

  describe("when its run has finished, stopped or failed", () => {
    /** @scenario "An eval chip sweeps while its run is under way" */
    it("lets the chip rest", () => {
      for (const status of ["finished", "cancelled", "failed"] as const) {
        expect(
          isInstantEvalBusy({ ...idle, chips, runs: { "run-1": { status } } }),
        ).toBe(false);
      }
      expect(
        isInstantEvalBusy({ ...idle, chips: [{ runId: null }], runs: {} }),
      ).toBe(false);
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
          run: { status: "cancelled", progress: 3_200, total: 10_000 },
          hasRun: true,
          isSettled: false,
        }),
      ).toBeNull();
      expect(
        instantEvalChipLabel({
          question: "the user is annoyed",
          mark: "(partial: 3,200 of 10,000 judged)",
        }),
      ).toBe('"the user is annoyed" (partial: 3,200 of 10,000 judged)');
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

describe("given a run with interrupted reporting", () => {
  const run = {
    id: "run-1",
    status: "running" as const,
    total: 100,
    progress: 20,
    matched: 4,
    failed: 0,
    skipped: 0,
    error: null,
    priceUsd: 0.1,
    finishedAtMs: null,
  };
  const processingBlock = {
    code: "instant_eval_processing_disabled" as const,
    observedAtMs: 10,
    stages: [
      { componentType: "command" as const, componentName: "recordPageJudged" },
    ],
  };

  describe("when a status read fails and recovers", () => {
    /** @scenario "A failed status read marks stale counts until a successful read" */
    it("marks stale data unavailable and clears only the transient warning", () => {
      harness.getResults = [{ data: run, dataUpdatedAt: 1 }];
      const watch = renderHook(() => useInstantEvalRunWatch());
      const counts = renderHook(() => useExplorerCounts());
      harness.getResults = [{ data: run, dataUpdatedAt: 1, isError: true }];
      watch.rerender();
      expect(counts.result.current.summary).toContain("may be outdated");
      expect(useInstantEvalRunStore.getState().readUnavailable[run.id]).toBe(
        true,
      );
      harness.getResults = [{ data: run, dataUpdatedAt: 1, isError: false }];
      watch.rerender();
      expect(counts.result.current.summary).toBe(
        "4 matched so far · 20 of 100 judged",
      );
      harness.getResults = [
        { data: { ...run, processingBlock }, dataUpdatedAt: 2 },
      ];
      watch.rerender();
      harness.getResults = [{ data: run, dataUpdatedAt: 1, isError: true }];
      watch.rerender();
      harness.getResults = [{ data: run, dataUpdatedAt: 3, isError: false }];
      watch.rerender();
      expect(counts.result.current.summary).toContain("may be incomplete");
      expect(harness.getQuery).toHaveBeenLastCalledWith(
        { projectId: "project-1", runId: "run-1" },
        expect.objectContaining({ refetchInterval: 1000 }),
      );
    });

    /** @scenario "A failed status read marks stale counts until a successful read" */
    it("does not invent counts when the first read fails", () => {
      harness.getResults = [{ data: undefined, isError: true }];
      renderHook(() => useInstantEvalRunWatch());
      const counts = renderHook(() => useExplorerCounts());
      expect(counts.result.current.summary).toBe(
        "Run status unavailable · counts unavailable",
      );
    });
  });

  describe("when a final table read is already in flight", () => {
    /** @scenario "Reporting interruption survives stale reads and settlement" */
    it("does not settle a newly interrupted run after that read completes", async () => {
      let finish: (() => void) | undefined;
      harness.invalidate.list.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const terminal = {
        ...run,
        status: "finished" as const,
        finishedAtMs: Date.now(),
      };
      harness.getResults = [{ data: terminal, dataUpdatedAt: 1 }];
      const watch = renderHook(() => useInstantEvalRunWatch());
      harness.getResults = [{ data: { ...terminal }, dataUpdatedAt: 2 }];
      watch.rerender();
      expect(useInstantEvalRunStore.getState().quiet[run.id]).toBe(true);
      harness.getResults = [
        { data: { ...terminal, processingBlock }, dataUpdatedAt: 3 },
      ];
      watch.rerender();
      await act(async () => {
        finish?.();
        await Promise.resolve();
      });
      expect(useInstantEvalRunStore.getState().settled[run.id]).toBeUndefined();
      expect(
        useInstantEvalRunStore.getState().runs[run.id]?.processingBlock,
      ).toEqual(processingBlock);
    });
  });

  describe("when chip, counts and empty content are resolved", () => {
    /** @scenario "Interrupted chips and counts never imply normal judging or completion" */
    it("keeps the chip identity and shows uncertain counts without a busy chip", () => {
      const interrupted = { ...run, processingBlock };
      act(() => useInstantEvalRunStore.getState().setRun(interrupted));
      const counts = renderHook(() => useExplorerCounts());
      expect(counts.result.current.summary).toContain("may be incomplete");
      expect(instantEvalChipMark({ run: interrupted, hasRun: true })).toBe(
        "(reporting interrupted)",
      );
      expect(
        emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24,
          isJudging: false,
          reportingPhase: "interrupted",
        }).description,
      ).toContain("may be incomplete");
      expect(
        isInstantEvalBusy({
          isEstimating: false,
          isStarting: false,
          chips: [{ runId: run.id }, { runId: "healthy-run" }],
          runs: { [run.id]: interrupted, "healthy-run": { status: "running" } },
        }),
      ).toBe(false);
    });
  });
});
