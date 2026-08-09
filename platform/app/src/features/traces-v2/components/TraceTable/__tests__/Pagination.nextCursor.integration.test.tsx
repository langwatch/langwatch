/**
 * @vitest-environment jsdom
 *
 * The trace table's pagination adapter: how the filter store's page state is
 * translated for the shared bar, and what each lens is allowed to reach.
 *
 * Keyset paging has no page numbers of its own: the batch the user sees next
 * is whatever `pageCursors[page]` addresses. So the one thing a step forward
 * must get right is WHICH page it files the returned cursor under — the page
 * it is opening, not the one it is leaving. File it under the current page and
 * every batch is fetched with the cursor of the batch before it.
 *
 * The pager dispatches on a microtask, so clicks are awaited rather than fired
 * and asserted in the same tick.
 *
 * See specs/traces-v2/data-layer.feature (keyset pagination) and
 * specs/components/pagination.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useFilterStore } from "../../../stores/filterStore";
import { useViewStore } from "../../../stores/viewStore";
import { Pagination } from "../Pagination";

const CURSOR_TO_PAGE_2 = { sortValue: 1_700_000_002_000, traceId: "trace-b" };
const CURSOR_TO_PAGE_3 = { sortValue: 1_700_000_001_000, traceId: "trace-c" };
const SESSION_CURSOR_TO_PAGE_2 = "session-cursor-2";

function renderPagination({
  nextCursor,
  totalHits = 500,
  visibleCount = 50,
  itemNoun,
  maxPageSize,
}: {
  nextCursor: { sortValue: number; traceId: string } | string | null;
  totalHits?: number;
  visibleCount?: number;
  itemNoun?: string;
  maxPageSize?: number;
}): void {
  render(
    <ChakraProvider value={defaultSystem}>
      <Pagination
        totalHits={totalHits}
        nextCursor={nextCursor}
        visibleCount={visibleCount}
        itemNoun={itemNoun}
        maxPageSize={maxPageSize}
      />
    </ChakraProvider>,
  );
}

const clickNext = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("pagination-next"));
};

const clickPage = async (page: number) => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`pagination-page-${page}`));
};

const pagination = () => {
  const { page, pageCursors } = useFilterStore.getState();
  return { page, pageCursors };
};

beforeEach(() => {
  useFilterStore.getState().clearAll();
  useFilterStore.setState({ pageSize: 50 });
  useViewStore.setState({ grouping: "flat" });
});
afterEach(() => cleanup());

describe("trace table pagination", () => {
  describe("given the first batch, which the server answered with a cursor", () => {
    describe("when the reader steps forward", () => {
      /** @scenario "Next follows the cursor when only the cursor knows the next page" */
      it("files that cursor under the batch it opens, leaving the first batch cursor-free", async () => {
        renderPagination({ nextCursor: CURSOR_TO_PAGE_2 });

        await clickNext();

        expect(pagination()).toEqual({
          page: 2,
          pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 },
        });
      });
    });

    describe("when the reader jumps past the batch the cursor opens", () => {
      /** @scenario "Jumping past the reached pages reads by position instead" */
      it("moves to that page with no cursor, leaving the read to fall back to position", async () => {
        renderPagination({ nextCursor: CURSOR_TO_PAGE_2 });

        await clickPage(5);

        expect(pagination()).toEqual({ page: 5, pageCursors: { 1: null } });
      });
    });
  });

  describe("given a lens whose data source caps the page size below the shared preference", () => {
    /** @scenario A larger persisted page size clamps to the sessions cap */
    it("counts the range by the clamped size and offers no sizes beyond the cap", () => {
      useFilterStore.setState({
        page: 2,
        pageSize: 250,
        pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 },
      });
      renderPagination({
        nextCursor: CURSOR_TO_PAGE_3,
        visibleCount: 100,
        maxPageSize: 100,
      });

      // Page 2 of a 100-row data source starts at row 101, whatever the
      // shared preference says.
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "showing 101–200",
      );
      const offered = Array.from(
        screen
          .getByTestId("pagination-page-size")
          .querySelectorAll<HTMLOptionElement>("option"),
      ).map((option) => option.value);
      expect(offered).toEqual(["25", "50", "100"]);
    });
  });

  describe("given the reader is already on the second batch", () => {
    describe("when the reader steps forward again", () => {
      it("files the new cursor under the third, without disturbing the second's", async () => {
        useFilterStore.setState({
          page: 2,
          pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 },
        });
        renderPagination({ nextCursor: CURSOR_TO_PAGE_3 });

        await clickNext();

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: {
            1: null,
            2: CURSOR_TO_PAGE_2,
            3: CURSOR_TO_PAGE_3,
          },
        });
      });
    });
  });

  describe("given the sessions lens, whose rows can only be reached in order", () => {
    beforeEach(() => {
      useViewStore.setState({ grouping: "by-conversation" });
    });

    /** @scenario "A page the data source cannot open is shown disabled" */
    it("offers the batches already walked and the next one, and refuses the rest", () => {
      useFilterStore.setState({
        page: 2,
        pageCursors: { 1: null, 2: SESSION_CURSOR_TO_PAGE_2 },
      });
      renderPagination({
        nextCursor: "session-cursor-3",
        itemNoun: "sessions",
        maxPageSize: 100,
      });

      expect(screen.getByTestId("pagination-page-1")).toBeEnabled();
      expect(screen.getByTestId("pagination-page-3")).toBeEnabled();
      expect(screen.getByTestId("pagination-page-4")).toBeDisabled();
    });

    /** @scenario "Next is unavailable once the data source has no further rows" */
    it("refuses the step forward once the server hands back no cursor", () => {
      useFilterStore.setState({
        page: 2,
        pageCursors: { 1: null, 2: SESSION_CURSOR_TO_PAGE_2 },
      });
      renderPagination({
        nextCursor: null,
        itemNoun: "sessions",
        maxPageSize: 100,
      });

      expect(screen.getByTestId("pagination-next")).toBeDisabled();
      expect(screen.getByTestId("pagination-page-4")).toBeDisabled();
    });

    it("names the rows sessions in the totals copy", () => {
      renderPagination({
        nextCursor: "session-cursor-2",
        totalHits: 120,
        visibleCount: 50,
        itemNoun: "sessions",
        maxPageSize: 100,
      });

      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "120 sessions · showing 1–50",
      );
    });
  });

  describe("given nothing has been found", () => {
    it("renders no bar at all", () => {
      renderPagination({ nextCursor: null, totalHits: 0, visibleCount: 0 });

      expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
    });
  });
});
