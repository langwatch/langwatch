/**
 * @vitest-environment jsdom
 *
 * `useExplorerCounts` is the one number every count on the Explorer reads.
 * It answers from the list read on every lens but Conversations, and from
 * the sessions read there, and never runs a count of its own. See
 * specs/traces-v2/search.feature ("Numbers that agree").
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

vi.mock("../useTraceListQuery", () => ({
  useTraceListQuery: () => mockList,
}));
vi.mock("../useSessionGroups", () => ({
  useSessionGroups: () => mockSessions,
}));

import { useViewStore } from "../../stores/viewStore";
import { useExplorerCounts } from "../useExplorerCounts";

beforeEach(() => {
  useViewStore.setState({ grouping: "flat" });
});

describe("useExplorerCounts", () => {
  describe("given a lens that walks the traces", () => {
    /** @scenario "The header, the pagination line and the sidebar total show one number" */
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
  });

  describe("given the Conversations lens", () => {
    it("answers the sessions read's total with no page trace ids", () => {
      useViewStore.setState({ grouping: "by-conversation" });
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
