/**
 * @vitest-environment jsdom
 *
 * The pagination line and the sidebar total print the same number, from the
 * same read. Both consume `useExplorerCounts`, which is fed here by mocked
 * list and sessions reads, so the assertion is on the wiring rather than on
 * a mocked selector. See specs/traces-v2/search.feature ("Numbers that
 * agree").
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

vi.mock("../../../hooks/useTraceListQuery", () => ({
  useTraceListQuery: () => mockList,
}));
vi.mock("../../../hooks/useSessionGroups", () => ({
  useSessionGroups: () => mockSessions,
  SESSIONS_MAX_PAGE_SIZE: 100,
}));

import { useFilterStore } from "../../../stores/filterStore";
import { useViewStore } from "../../../stores/viewStore";
import { ExplorerTotal } from "../../FilterSidebar/ExplorerTotal";
import { Pagination } from "../Pagination";

function renderBoth(): void {
  render(
    <ChakraProvider value={defaultSystem}>
      <ExplorerTotal />
      <Pagination nextCursor={null} visibleCount={1} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  useFilterStore.getState().clearAll();
  useFilterStore.setState({ pageSize: 50 });
  useViewStore.setState({ grouping: "flat" });
});
afterEach(() => cleanup());

describe("the Explorer's counts", () => {
  describe("given the list read answered a total", () => {
    /** @scenario "The header, the pagination line and the sidebar total show one number" */
    it("prints that number on the sidebar total and the pagination line", () => {
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent(
        "1,234 traces",
      );
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "1,234 traces",
      );
    });
  });

  describe("given the Conversations lens", () => {
    it("prints the sessions read's number on both, as conversations", () => {
      useViewStore.setState({ grouping: "by-conversation" });
      renderBoth();
      expect(screen.getByTestId("explorer-total")).toHaveTextContent(
        "7 conversations",
      );
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "7 conversations",
      );
    });
  });
});
