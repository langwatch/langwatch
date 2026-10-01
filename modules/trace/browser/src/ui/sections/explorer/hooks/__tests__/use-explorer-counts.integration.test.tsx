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

import { useExplorerStore } from "@langwatch/trace-browser-kit";

import { useExplorerCounts } from "../use-explorer-counts.ts";

beforeEach(() => {
  useExplorerStore.setState({ grouping: "flat" });
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
});
