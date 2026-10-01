/**
 * @vitest-environment jsdom
 *
 * Both surfaces print one number from one read: the list and sessions reads are
 * mocked, so the assertion is on the wiring rather than a mocked selector.
 * @see specs/traces-v2/search.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockList = {
  data: [{ traceId: "t-1" }],
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
  isFetching: false,
  isPlaceholderData: false,
  isError: false,
  error: null,
};

vi.mock("../../hooks/use-trace-list-query.ts", () => ({
  useTraceListQuery: () => mockList,
}));
vi.mock("../../hooks/use-session-groups.ts", () => ({
  useSessionGroups: () => mockSessions,
  SESSIONS_MAX_PAGE_SIZE: 100,
}));

import { useExplorerStore } from "@langwatch/trace-browser-kit";

import { ExplorerTotal } from "../../filter-sidebar/explorer-total.tsx";
import { Pagination } from "../pagination.tsx";

function renderBoth(): void {
  render(
    <ChakraProvider value={defaultSystem}>
      <ExplorerTotal />
      <Pagination nextCursor={null} visibleCount={1} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  // The reads are plain objects a case may retotal, so each one starts from the
  // same numbers regardless of the order they run in.
  mockList.totalHits = 1234;
  mockSessions.totalHits = 7;
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({ pageSize: 50, grouping: "flat" });
});
afterEach(() => cleanup());

describe("the Explorer's counts", () => {
  describe("given the list read answered a total", () => {
    /** @scenario "The pagination line and the sidebar total show one number" */
    it("prints that number on the sidebar total and the pagination line", () => {
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent("1,234 traces");
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("1,234 traces");
    });
  });

  describe("given the Conversations lens", () => {
    it("prints the sessions read's number on both, as conversations", () => {
      useExplorerStore.setState({ grouping: "by-conversation" });
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent("7 conversations");
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("7 conversations");
    });
  });

  describe("given the total is one", () => {
    /** @scenario "A total of one is named in the singular" */
    it("names a single trace in the singular on both surfaces", () => {
      mockList.totalHits = 1;
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent("1 trace");
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("1 trace");
      expect(screen.getByTestId("explorer-total")).not.toHaveTextContent("1 traces");
    });

    it("names a single conversation in the singular on both surfaces", () => {
      mockSessions.totalHits = 1;
      useExplorerStore.setState({ grouping: "by-conversation" });
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent("1 conversation");
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent("1 conversation");
      expect(screen.getByTestId("explorer-total")).not.toHaveTextContent("1 conversations");
    });
  });
});
