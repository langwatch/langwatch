import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_TIME_RANGE, useFilterStore } from "../src/filter.store";

/**
 * The trace list is keyset-paged: `pageCursors[n].sortValue` is the sort value
 * of the last row of batch n-1, and the server pages by comparing it against
 * the CURRENT sort expression + filter. That makes every cursor a claim about
 * one specific result set — narrow the filter or move the time window and the
 * claim is void. Because `totalHits` is computed without the cursor, and
 * `Pagination` derives its row range from the page number rather than the rows
 * that came back, a stale cursor doesn't surface as an empty state; it
 * surfaces as a blank table under a caption that still reports the whole count
 * and a live-looking range ("… traces · showing 101–101" on page 3). These
 * tests pin which mutations are obliged to throw the cursors away, and which
 * must leave them alone.
 *
 * `filterStore` itself is unchanged by the work that added this file — these
 * are characterization tests, standing as a forward regression net around
 * behaviour the pagination fix now depends on.
 *
 * Which page a freshly minted cursor is filed under is deliberately NOT tested
 * here: that is Next's decision, and `setPageCursor`/`setPage` are plain
 * assignments, so asserting them would only echo their own arguments back. It
 * is pinned where it can actually break, in
 * `components/TraceTable/__tests__/Pagination.nextCursor.integration.test.tsx`.
 */

const CURSOR_PAGE_2 = { sortValue: 1_700_000_002_000, traceId: "trace-b" };
const CURSOR_PAGE_3 = { sortValue: 1_700_000_001_000, traceId: "trace-c" };

/** Put the store where a user lands after clicking Next twice. */
function seedThirdPage(): void {
  useFilterStore.setState({
    page: 3,
    pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
  });
}

const pagination = () => {
  const { page, pageCursors } = useFilterStore.getState();
  return { page, pageCursors };
};

const FIRST_PAGE = { page: 1, pageCursors: { 1: null } };

beforeEach(() => {
  useFilterStore.getState().clearAll();
  useFilterStore.setState({
    pageSize: 50,
    timeRange: INITIAL_TIME_RANGE,
    debouncedTimeRange: INITIAL_TIME_RANGE,
  });
});

describe("filterStore keyset cursors", () => {
  describe("given the user has paged forward to the third batch", () => {
    beforeEach(() => seedThirdPage());

    describe("when the query text changes", () => {
      it("drops every cursor and returns to the first batch", () => {
        useFilterStore.getState().applyQueryText("status:error");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when a facet is toggled from the sidebar", () => {
      it("drops every cursor and returns to the first batch", () => {
        useFilterStore.getState().toggleFacet("status", "error");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when a lens's saved filter is applied", () => {
      it("drops every cursor and returns to the first batch", () => {
        useFilterStore.getState().setFilterFromLens("model:gpt-5-mini");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the time range is changed", () => {
      it("drops every cursor and returns to the first batch", () => {
        useFilterStore.getState().setTimeRange({
          from: 1_700_000_000_000,
          to: 1_700_003_600_000,
          label: "Last 1 hour",
          presetId: "1h",
        });
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the page size is changed", () => {
      it("drops every cursor — the batch boundaries have moved", () => {
        useFilterStore.getState().setPageSize(100);
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the whole filter is cleared", () => {
      it("drops every cursor and returns to the first batch", () => {
        useFilterStore.getState().clearAll();
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when a rolling preset rolls its window forward", () => {
      it("keeps the cursors — the range is the same window, just re-anchored", () => {
        useFilterStore.getState().rollTimeRange({
          from: 1_700_000_060_000,
          to: 1_700_003_660_000,
          label: "Last 1 hour",
          presetId: "1h",
        });
        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });

    describe("when the user steps back one page", () => {
      it("keeps the cursors so the previous batch is reachable without a refetch walk", () => {
        useFilterStore.getState().setPage(2);
        expect(pagination()).toEqual({
          page: 2,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });
  });
});
