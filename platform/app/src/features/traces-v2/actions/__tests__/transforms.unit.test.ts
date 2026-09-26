/**
 * The Explorer's pure transforms: state in, state out, a refusal code from a
 * closed list, and the given state never changed by a refusal.
 *
 * Spec: specs/traces-v2/explorer-actions.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFilter, toggleFacet } from "../transforms/query";
import { expandRow, select } from "../transforms/rows";
import { setTimeRange } from "../transforms/timeRange";
import {
  EXPLORER_TRANSFORM_ERROR_CODES,
  ExplorerTransformError,
  type ExplorerTransformErrorCode,
} from "../transforms/types";
import {
  setGrouping,
  setLens,
  setPage,
  setPageSize,
  setSort,
} from "../transforms/view";
import { explorerState, NOW } from "./explorerFixtures";

function refusalOf(run: () => unknown): ExplorerTransformErrorCode | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ExplorerTransformError) return error.code;
    throw error;
  }
}

describe("given the closed list of refusal codes", () => {
  it("names every code a transform throws", () => {
    expect(EXPLORER_TRANSFORM_ERROR_CODES).toEqual([
      "filter_invalid",
      "time_range_invalid",
      "preset_unknown",
      "lens_not_found",
      "sort_column_unknown",
      "page_out_of_range",
      "page_size_invalid",
      "invalid_payload",
    ]);
  });
});

describe("setFilter", () => {
  describe("when given a query on page 3", () => {
    /** @scenario "A filter transform replaces the query and returns to the first page" */
    it("replaces the query and returns to the first page", () => {
      const state = explorerState({ queryText: "status:error", page: 3 });
      const next = setFilter({
        state,
        payload: { query: "model:gpt-5-mini" },
      });
      expect(next.state.queryText).toBe("model:gpt-5-mini");
      expect(next.state.page).toBe(1);
      expect(next.result).toEqual({ query: "model:gpt-5-mini" });
    });
  });

  describe("when given a query in add mode", () => {
    /** @scenario "A filter added to the query is joined with AND" */
    it("joins it to the query on screen with AND", () => {
      const next = setFilter({
        state: explorerState({ queryText: "status:error" }),
        payload: { query: "model:gpt-5-mini", mode: "add" },
      });
      expect(next.state.queryText).toBe("status:error AND model:gpt-5-mini");
    });
  });

  describe("when given a query that does not parse", () => {
    /** @scenario "A filter the language refuses leaves the state untouched" */
    it("refuses with filter_invalid and leaves the given state as it was", () => {
      const state = explorerState({ queryText: "status:error" });
      expect(
        refusalOf(() => setFilter({ state, payload: { query: "status:(" } })),
      ).toBe("filter_invalid");
      expect(state.queryText).toBe("status:error");
    });
  });

  describe("when given an empty query", () => {
    it("clears the search", () => {
      const next = setFilter({
        state: explorerState({ queryText: "status:error" }),
        payload: { query: "  " },
      });
      expect(next.state.queryText).toBe("");
    });
  });
});

describe("toggleFacet", () => {
  describe("when the same value is clicked three times", () => {
    /** @scenario "A facet toggled twice is excluded, and a third time is neutral" */
    it("steps through included, excluded and neutral", () => {
      const payload = { field: "status", value: "error" };
      const first = toggleFacet({ state: explorerState(), payload });
      const second = toggleFacet({ state: first.state, payload });
      const third = toggleFacet({ state: second.state, payload });
      expect([
        first.state.queryText,
        second.state.queryText,
        third.state.queryText,
      ]).toEqual(["status:error", "NOT status:error", ""]);
    });
  });

  describe("when a second value of the same field is clicked", () => {
    /** @scenario "A second value of one field joins the first with OR" */
    it("joins the two values with OR", () => {
      const next = toggleFacet({
        state: explorerState({ queryText: "origin:application" }),
        payload: { field: "origin", value: "evaluation" },
      });
      expect(next.state.queryText).toBe(
        "(origin:application OR origin:evaluation)",
      );
    });
  });

  describe("when asked to exclude a value", () => {
    it("excludes it in one step", () => {
      const next = toggleFacet({
        state: explorerState(),
        payload: { field: "status", value: "error", exclude: true },
      });
      expect(next.state.queryText).toBe("NOT status:error");
    });
  });
});

describe("setTimeRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when given a preset", () => {
    /** @scenario "A preset window is resolved at apply time and keeps its preset id" */
    it("resolves the window now and keeps the preset id", () => {
      const next = setTimeRange({
        state: explorerState({ page: 4 }),
        payload: { preset: "7d" },
      });
      expect(next.state.timeRange.to).toBe(NOW);
      expect(next.state.timeRange.from).toBe(NOW - 7 * 24 * 3_600_000);
      expect(next.state.timeRange.presetId).toBe("7d");
      expect(next.state.page).toBe(1);
    });
  });

  describe("when given a window that ends before it starts", () => {
    /** @scenario "An absolute window must end after it starts" */
    it("refuses with time_range_invalid", () => {
      expect(
        refusalOf(() =>
          setTimeRange({
            state: explorerState(),
            payload: { from: NOW, to: NOW - 1 },
          }),
        ),
      ).toBe("time_range_invalid");
    });
  });

  describe("when given bounds as ISO 8601", () => {
    it("keeps them as exact bounds with no preset", () => {
      const next = setTimeRange({
        state: explorerState(),
        payload: {
          from: "2026-09-01T00:00:00.000Z",
          to: "2026-09-02T00:00:00.000Z",
        },
      });
      expect(next.state.timeRange).toEqual({
        from: Date.UTC(2026, 8, 1),
        to: Date.UTC(2026, 8, 2),
      });
    });
  });

  describe("when given a preset the picker does not offer", () => {
    /** @scenario "An unknown preset is refused by name" */
    it("refuses with preset_unknown", () => {
      expect(
        refusalOf(() =>
          setTimeRange({
            state: explorerState(),
            payload: { preset: "fortnight" },
          }),
        ),
      ).toBe("preset_unknown");
    });
  });
});

const ERRORS_LENS = {
  id: "errors",
  filterText: "status:error",
  sort: { columnId: "time", direction: "desc" as const },
  grouping: "flat" as const,
  columns: ["time", "trace", "error"],
};

describe("setLens", () => {
  describe("when the page holds the lens", () => {
    /** @scenario "A lens transform installs the lens's own filter, sort, grouping and columns" */
    it("installs the lens's filter, sort, grouping and columns", () => {
      const next = setLens({
        state: explorerState({ page: 2 }),
        payload: { lensId: "errors" },
        context: { lenses: [ERRORS_LENS] },
      });
      expect(next.state).toMatchObject({
        activeLensId: "errors",
        queryText: "status:error",
        sort: ERRORS_LENS.sort,
        grouping: "flat",
        columnOrder: ERRORS_LENS.columns,
        page: 1,
      });
    });
  });

  describe("when the page does not hold the lens", () => {
    /** @scenario "A lens the page does not hold is refused" */
    it("refuses with lens_not_found", () => {
      expect(
        refusalOf(() =>
          setLens({
            state: explorerState(),
            payload: { lensId: "no-such-lens" },
            context: { lenses: [ERRORS_LENS] },
          }),
        ),
      ).toBe("lens_not_found");
    });
  });

  describe("when no lens list is given", () => {
    it("moves only the lens id, for the page to install on arrival", () => {
      const state = explorerState({ queryText: "model:gpt-5-mini" });
      const next = setLens({ state, payload: { lensId: "conversations" } });
      expect(next.state.activeLensId).toBe("conversations");
      expect(next.state.queryText).toBe("model:gpt-5-mini");
    });
  });
});

describe("setSort", () => {
  describe("when given a sortable column on page 4", () => {
    /** @scenario "A sort change returns to the first page" */
    it("sorts and returns to the first page", () => {
      const next = setSort({
        state: explorerState({ page: 4 }),
        payload: { columnId: "cost", direction: "desc" },
      });
      expect(next.state.sort).toEqual({ columnId: "cost", direction: "desc" });
      expect(next.state.page).toBe(1);
    });
  });

  describe("when given a column the table cannot sort by", () => {
    it("refuses with sort_column_unknown", () => {
      expect(
        refusalOf(() =>
          setSort({
            state: explorerState(),
            payload: { columnId: "not-a-column", direction: "asc" },
          }),
        ),
      ).toBe("sort_column_unknown");
    });
  });
});

describe("setGrouping", () => {
  describe("when two rows are open", () => {
    /** @scenario "A grouping change closes the open rows" */
    it("regroups and closes the open rows", () => {
      const next = setGrouping({
        state: explorerState({ expandedRows: new Set(["a", "b"]) }),
        payload: { grouping: "by-conversation" },
      });
      expect(next.state.grouping).toBe("by-conversation");
      expect(next.state.expandedRows.size).toBe(0);
    });
  });
});

describe("setPage", () => {
  describe("when the last read counted 120 rows at 50 per page", () => {
    /** @scenario "A page past the last one is refused" */
    it("refuses page 4 with page_out_of_range", () => {
      expect(
        refusalOf(() =>
          setPage({
            state: explorerState(),
            payload: { page: 4 },
            context: { totalHits: 120 },
          }),
        ),
      ).toBe("page_out_of_range");
    });

    it("goes to page 3, the last one", () => {
      const next = setPage({
        state: explorerState(),
        payload: { page: 3 },
        context: { totalHits: 120 },
      });
      expect(next.state.page).toBe(3);
    });
  });
});

describe("setPageSize", () => {
  describe("when given a size the table does not offer", () => {
    /** @scenario "A page size outside the offered sizes is refused" */
    it("refuses with page_size_invalid", () => {
      expect(
        refusalOf(() =>
          setPageSize({ state: explorerState(), payload: { pageSize: 37 } }),
        ),
      ).toBe("page_size_invalid");
    });
  });

  describe("when given an offered size", () => {
    it("sets it and returns to the first page", () => {
      const next = setPageSize({
        state: explorerState({ page: 5 }),
        payload: { pageSize: 100 },
      });
      expect(next.state).toMatchObject({ pageSize: 100, page: 1 });
    });
  });
});

describe("select", () => {
  describe("when given two trace ids and a blank one", () => {
    /** @scenario "A selection holds only ids that address a trace" */
    it("holds the two trace ids", () => {
      const next = select({
        state: explorerState(),
        payload: { traceIds: ["trace-a", "  ", "trace-b"] },
      });
      expect(Array.from(next.state.selection.traceIds)).toEqual([
        "trace-a",
        "trace-b",
      ]);
      expect(next.result).toEqual({ mode: "explicit", selected: 2 });
    });
  });

  describe("when given all matching over an explicit selection", () => {
    /** @scenario "Selecting all matching rows drops the explicit ids" */
    it("selects all matching with no explicit ids", () => {
      const next = select({
        state: explorerState({
          selection: { mode: "explicit", traceIds: new Set(["a", "b"]) },
        }),
        payload: { allMatching: true },
      });
      expect(next.state.selection.mode).toBe("all-matching");
      expect(next.state.selection.traceIds.size).toBe(0);
    });
  });
});

describe("expandRow", () => {
  describe("when another row is opened exclusively", () => {
    /** @scenario "Expanding a row exclusively closes the others" */
    it("leaves only that row open", () => {
      const next = expandRow({
        state: explorerState({ expandedRows: new Set(["conversation-a"]) }),
        payload: { key: "conversation-b", exclusive: true },
      });
      expect(Array.from(next.state.expandedRows)).toEqual(["conversation-b"]);
    });
  });

  describe("when an open row is toggled", () => {
    it("closes it and leaves the others open", () => {
      const next = expandRow({
        state: explorerState({ expandedRows: new Set(["a", "b"]) }),
        payload: { key: "a" },
      });
      expect(Array.from(next.state.expandedRows)).toEqual(["b"]);
    });
  });
});
