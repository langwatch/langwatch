/**
 * @vitest-environment jsdom
 *
 * The page size and the page steps the trace table's pagination bar offers.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { explorerCountSummary } from "../../../../../model/explorer/explorer-count-summary.ts";
import { Pagination } from "../pagination.tsx";

const mockCounts = {
  totalHits: 583,
  itemNoun: "traces",
  instantEval: null,
  summary: explorerCountSummary({ totalHits: 583, itemNoun: "traces", instantEval: null }),
};
vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => mockCounts,
}));

const CURSOR_TO_PAGE_2 = { sortValue: 1_700_000_002_000, traceId: "trace-b" };

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});
afterEach(() => cleanup());

describe("the trace table pagination bar", () => {
  describe("given a project with 583 traces on a fresh view", () => {
    /** @scenario Default page size is 50 */
    it("pages by 50 and counts 12 pages over the 583 traces", () => {
      renderWithDesignSystem(<Pagination nextCursor={CURSOR_TO_PAGE_2} visibleCount={50} />);

      expect(useExplorerStore.getState().pageSize).toBe(50);
      const indicator = screen.getByTestId("pagination-indicator");
      expect(indicator).toHaveTextContent("583 traces");
      expect(indicator).toHaveTextContent("showing 1–50");
      expect(screen.getByTestId("pagination-page-12")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-13")).toBeNull();
    });
  });

  describe("when the reader looks at the page-size control", () => {
    /** @scenario Page size selector exposes the supported sizes */
    it("offers 25, 50, 100, 250, 500 and 1000 with 50 chosen", () => {
      renderWithDesignSystem(<Pagination nextCursor={null} visibleCount={50} />);

      const control = screen.getByTestId("pagination-page-size") as HTMLSelectElement;
      const offered = Array.from(control.querySelectorAll<HTMLOptionElement>("option")).map(
        (option) => option.value,
      );
      expect(offered).toEqual(["25", "50", "100", "250", "500", "1000"]);
      expect(control.value).toBe("50");
    });
  });

  describe("given the reader is on page 1", () => {
    /** @scenario Next page navigates forward */
    it("moves to page 2, which reads the next 50 traces through the cursor", async () => {
      renderWithDesignSystem(<Pagination nextCursor={CURSOR_TO_PAGE_2} visibleCount={50} />);

      await userEvent.setup().click(screen.getByTestId("pagination-next"));

      const { page, pageCursors, pageSize } = useExplorerStore.getState();
      expect({ page, pageSize }).toEqual({ page: 2, pageSize: 50 });
      expect(pageCursors[2]).toEqual(CURSOR_TO_PAGE_2);
    });
  });

  describe("given the reader is on page 2", () => {
    /** @scenario Previous page navigates backward */
    it("returns to page 1", async () => {
      useExplorerStore.setState({ page: 2, pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 } });
      renderWithDesignSystem(<Pagination nextCursor={null} visibleCount={50} />);

      await userEvent.setup().click(screen.getByTestId("pagination-prev"));

      expect(useExplorerStore.getState().page).toBe(1);
    });
  });
});
