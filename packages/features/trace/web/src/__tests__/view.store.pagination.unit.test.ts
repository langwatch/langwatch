import { beforeEach, describe, expect, it } from "vitest";
import { useFilterStore } from "../filter.store";
import { useViewStore } from "../view.store";

/**
 * Sort lives in viewStore, the keyset cursors live in filterStore, and the
 * server joins them: it pages by comparing a cursor's stored `sortValue`
 * against whatever the current sort expression is. So every route into a new
 * sort has to drop the cursors — including the one that doesn't look like a
 * sort change at all. `setGrouping` rewrites `sort` through `reconcileSort`,
 * because a grouped RowKind can't order by `time`/`spans`/`ttft`/`size` and
 * those all reconcile to `count`. Left carrying a flat-lens cursor, the query
 * compares a span count against epoch milliseconds and returns nothing, while
 * the cursor-free `totalHits` keeps reporting the whole count and `Pagination`
 * keeps captioning a row range off the page number ("… traces · showing
 * 101–101" on page 3) — so the blank table never admits to being empty.
 */

const CURSOR_PAGE_2 = { sortValue: 42, traceId: "trace-b" };
const CURSOR_PAGE_3 = { sortValue: 17, traceId: "trace-c" };

const FIRST_PAGE = { page: 1, pageCursors: { 1: null } };

const view = () => useViewStore.getState();

const pagination = () => {
  const { page, pageCursors } = useFilterStore.getState();
  return { page, pageCursors };
};

/** Put both stores where a user lands after sorting, then clicking Next twice. */
function seedThirdPageSortedBy(sort: {
  columnId: string;
  direction: "asc" | "desc";
}): void {
  useViewStore.setState({
    activeLensId: "all-traces",
    grouping: "flat",
    sort,
    columnOrder: ["time", "trace", "service", "duration", "cost", "tokens"],
    draftState: new Map(),
  });
  useFilterStore.setState({
    page: 3,
    pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
  });
}

/** The same, one batch earlier: the state a single click of Next leaves. */
function seedSecondPageSortedBy(sort: {
  columnId: string;
  direction: "asc" | "desc";
}): void {
  seedThirdPageSortedBy(sort);
  useFilterStore.setState({
    page: 2,
    pageCursors: { 1: null, 2: CURSOR_PAGE_2 },
  });
}

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

describe("viewStore sort and grouping vs. the keyset cursors", () => {
  describe("given a flat lens sorted by Spans, paged forward to the third batch", () => {
    beforeEach(() => seedThirdPageSortedBy({ columnId: "spans", direction: "desc" }));

    describe("when the user switches to by-service grouping", () => {
      it("drops the cursors, because the reconciled sort is a different column", () => {
        view().setGrouping("by-service");

        expect(view().sort.columnId).toBe("count");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the user switches to by-conversation grouping", () => {
      it("drops the cursors — conversation rows cannot order by Spans either", () => {
        view().setGrouping("by-conversation");

        // The sessions grouping reconciles unsupported sorts to its default,
        // last activity descending.
        expect(view().sort.columnId).toBe("lastTurn");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });
  });

  describe("given a flat lens sorted by Cost, paged forward to the third batch", () => {
    beforeEach(() => seedThirdPageSortedBy({ columnId: "cost", direction: "desc" }));

    describe("when the user switches to by-service grouping", () => {
      it("keeps the cursors — Cost survives reconciliation, so they still address the same rows", () => {
        view().setGrouping("by-service");

        expect(view().sort).toEqual({ columnId: "cost", direction: "desc" });
        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });

    describe("when the user sorts by a different column", () => {
      it("drops the cursors", () => {
        view().setSort({ columnId: "duration", direction: "desc" });

        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the user flips only the sort direction", () => {
      it("drops the cursors — direction flips the keyset comparison operator", () => {
        view().setSort({ columnId: "cost", direction: "asc" });

        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the same sort is re-applied", () => {
      it("keeps the cursors — a no-op must not knock the user back to page 1", () => {
        view().setSort({ columnId: "cost", direction: "desc" });

        expect(pagination()).toEqual({
          page: 3,
          pageCursors: { 1: null, 2: CURSOR_PAGE_2, 3: CURSOR_PAGE_3 },
        });
      });
    });
  });

  describe("given a flat lens on its default Time sort, paged forward", () => {
    beforeEach(() => seedThirdPageSortedBy({ columnId: "time", direction: "desc" }));

    describe("when the user switches to by-service grouping and straight back to flat", () => {
      it("leaves the table on the first batch rather than a cursor minted under Time", () => {
        view().setGrouping("by-service");
        view().setGrouping("flat");

        expect(view().sort.columnId).toBe("time");
        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });
  });

  // The second batch is the boundary worth pinning on its own: it is the first
  // page that holds a cursor at all, and the sessions lens pages with opaque
  // strings while the flat list pages with objects. A cursor surviving this
  // switch is one lens reading the other's cursor space.
  describe("given the second batch, one click of Next from the start", () => {
    describe("when the user switches from the flat list to Sessions", () => {
      beforeEach(() => seedSecondPageSortedBy({ columnId: "time", direction: "desc" }));

      /** @scenario Switching lenses does not carry a cursor across */
      it("starts Sessions at its own first batch", () => {
        view().setGrouping("by-conversation");

        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });

    describe("when the user switches from Sessions back to the flat list", () => {
      beforeEach(() => {
        seedSecondPageSortedBy({ columnId: "lastTurn", direction: "desc" });
        useViewStore.setState({ grouping: "by-conversation" });
        useFilterStore.setState({
          page: 2,
          pageCursors: { 1: null, 2: "opaque-sessions-cursor" },
        });
      });

      /** @scenario Switching lenses does not carry a cursor across */
      it("leaves no sessions cursor behind for the flat list to read", () => {
        view().setGrouping("flat");

        expect(pagination()).toEqual(FIRST_PAGE);
      });
    });
  });
});
