/**
 * @vitest-environment jsdom
 *
 * The one number every count on the Explorer reads: the list read's, or the
 * sessions read's on Conversations, and never a count of its own.
 * @see specs/traces-v2/search.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockList = {
  data: [{ traceId: "t-1" }, { traceId: "t-2" }],
  totalHits: 1234,
  nextCursor: null,
  isLoading: false,
  isFetching: false,
  isPlaceholderData: false,
  isFetched: true,
  isError: false,
  error: null,
  isSamplePreview: false,
};
const mockSessions = {
  groups: [],
  totalHits: 7,
  nextCursor: null,
  isLoading: false,
  isFetching: true,
  isPlaceholderData: true,
  isError: false,
  error: null,
};

vi.mock("../use-trace-list-query.ts", () => ({
  useTraceListQuery: () => mockList,
}));
vi.mock("../use-session-groups.ts", () => ({
  useSessionGroups: () => mockSessions,
  SESSIONS_MAX_PAGE_SIZE: 100,
}));

import type { ExplorerInstantEvalProgress } from "@langwatch/instant-eval-contract";
import { instantEvalRunKey, queryWithoutInstantEvalChips } from "@langwatch/trace-contract";

import { useExplorerStore, useFilterStore } from "../../../../behavior/explorer.store.ts";
import { useInstantEvalRunStore } from "../../../instant-eval/behavior/instant-eval-run.store.ts";
import { useExplorerCounts } from "../use-explorer-counts.ts";

beforeEach(() => {
  useExplorerStore.setState({ grouping: "flat" });
  useFilterStore.setState({ debouncedQueryText: "", evalRuns: {} });
  useInstantEvalRunStore.setState({ runs: {}, stoppedByUser: {}, quiet: {}, settled: {} });
});

describe("useExplorerCounts", () => {
  describe("given a lens that walks the traces", () => {
    /** @scenario "One selector answers the total, the noun and the page ids" */
    it("answers the list read's total, noun and page ids", () => {
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current).toEqual({
        totalHits: 1234,
        itemNoun: "traces",
        pageTraceIds: ["t-1", "t-2"],
        isLoading: false,
        isFetching: false,
        isPlaceholderData: false,
        instantEval: null,
        summary: "1,234 traces",
      });
    });

    it("leaves the count the page shows in the store, for a reader of the page state", () => {
      renderHook(() => useExplorerCounts());
      expect(useExplorerStore.getState().results).toEqual({
        totalHits: 1234,
        itemNoun: "traces",
        pageTraceIds: ["t-1", "t-2"],
        isSettled: true,
      });
    });
  });

  describe("given the Conversations lens", () => {
    it("answers the sessions read's total with no page trace ids", () => {
      useExplorerStore.setState({ grouping: "by-conversation" });
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current).toEqual({
        totalHits: 7,
        itemNoun: "conversations",
        pageTraceIds: [],
        isLoading: false,
        isFetching: true,
        isPlaceholderData: true,
        instantEval: null,
        summary: "7 conversations",
      });
    });
  });

  describe("given a NOT eval chip with no run behind it", () => {
    /** @scenario "A pending chip under NOT is not judged yet" */
    it("counts none of the rows it lists, since none was judged", () => {
      useFilterStore.setState({ debouncedQueryText: 'NOT eval.trace:"the user is annoyed"' });
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current).toMatchObject({ totalHits: 0, pageTraceIds: [], summary: "0 traces" });
    });

    /** @scenario "A pending chip under NOT is not judged yet" */
    it("counts the rows of a bare chip never typed here, as it may name an evaluator", () => {
      useFilterStore.setState({ debouncedQueryText: "NOT eval:my_evaluator" });
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current).toMatchObject({ totalHits: 1234, pageTraceIds: ["t-1", "t-2"] });
    });

    /** @scenario "A pending chip under NOT is not judged yet" */
    it("shows no counters of another chip's run that is still judging", () => {
      const window = { from: 1_000, to: 2_000 };
      const queryText = 'eval.trace:"a" AND NOT eval.trace:"b"';
      const keyOfA = instantEvalRunKey({
        question: "a",
        target: "traces",
        otherQuery: queryWithoutInstantEvalChips(queryText),
        window,
      });
      useFilterStore.setState({
        debouncedQueryText: queryText,
        debouncedTimeRange: window,
        evalRuns: { [keyOfA]: "run-a" },
      });
      useInstantEvalRunStore.setState({
        runs: { "run-a": judgingRun({ id: "run-a", matched: 12 }) },
      });
      const { result } = renderHook(() => useExplorerCounts());
      expect(result.current).toMatchObject({
        totalHits: 0,
        instantEval: null,
        summary: "0 traces",
      });
    });
  });
});

function judgingRun(
  overrides: Partial<ExplorerInstantEvalProgress> = {},
): ExplorerInstantEvalProgress {
  return {
    id: "run-1",
    status: "running",
    total: 100,
    progress: 40,
    matched: 0,
    failed: 0,
    skipped: 0,
    error: null,
    priceUsd: 0.01,
    finishedAtMs: null,
    ...overrides,
  };
}
