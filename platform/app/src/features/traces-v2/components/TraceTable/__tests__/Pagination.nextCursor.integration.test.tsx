/**
 * @vitest-environment jsdom
 *
 * Keyset paging has no page numbers of its own: the batch the user sees next
 * is whatever `pageCursors[page]` addresses. So the one thing Next must get
 * right is WHICH page it files the returned cursor under — the page it is
 * opening, not the one it is leaving. File it under the current page and every
 * batch is fetched with the cursor of the batch before it, and
 * `useTraceListQuery` finds no cursor for the page it just moved to and snaps
 * straight back to the first batch.
 *
 * See specs/traces-v2/data-layer.feature (keyset pagination).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFilterStore } from "../../../stores/filterStore";
import { Pagination } from "../Pagination";

const CURSOR_TO_PAGE_2 = { sortValue: 1_700_000_002_000, traceId: "trace-b" };
const CURSOR_TO_PAGE_3 = { sortValue: 1_700_000_001_000, traceId: "trace-c" };

function renderPagination(
  nextCursor: {
    sortValue: number;
    traceId: string;
  },
  props: { visibleCount?: number; maxPageSize?: number } = {},
): void {
  render(
    <ChakraProvider value={defaultSystem}>
      <Pagination
        totalHits={500}
        nextCursor={nextCursor}
        visibleCount={props.visibleCount ?? 50}
        maxPageSize={props.maxPageSize}
      />
    </ChakraProvider>,
  );
}

function clickNext(): void {
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
}

const pagination = () => {
  const { page, pageCursors } = useFilterStore.getState();
  return { page, pageCursors };
};

beforeEach(() => {
  useFilterStore.getState().clearAll();
  useFilterStore.setState({ pageSize: 50 });
});
afterEach(() => cleanup());

describe("Pagination Next", () => {
  describe("given the first batch, which the server answered with a cursor", () => {
    describe("when the user clicks Next", () => {
      it("files that cursor under the batch it opens, leaving the first batch cursor-free", () => {
        renderPagination(CURSOR_TO_PAGE_2);

        clickNext();

        expect(pagination()).toEqual({
          page: 2,
          pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 },
        });
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
      renderPagination(CURSOR_TO_PAGE_3, {
        visibleCount: 100,
        maxPageSize: 100,
      });

      // Page 2 of a 100-row data source starts at row 101, whatever the
      // shared preference says.
      expect(screen.getByText(/showing 101–200/)).toBeDefined();
      expect(screen.queryByRole("button", { name: "250" })).toBeNull();
      expect(screen.queryByRole("button", { name: "1000" })).toBeNull();
      expect(screen.getByRole("button", { name: "100" })).toBeDefined();
    });
  });

  describe("given the user is already on the second batch", () => {
    describe("when the user clicks Next again", () => {
      it("files the new cursor under the third, without disturbing the second's", () => {
        useFilterStore.setState({
          page: 2,
          pageCursors: { 1: null, 2: CURSOR_TO_PAGE_2 },
        });
        renderPagination(CURSOR_TO_PAGE_3);

        clickNext();

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
});
