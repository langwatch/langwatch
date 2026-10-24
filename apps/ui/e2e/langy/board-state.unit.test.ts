import { describe, expect, it } from "vitest";

import {
  type BoardItem,
  type BoardSnapshot,
  type ChartResource,
  countOf,
  diffBoards,
  type QueryOutcome,
  statementsOf,
  type WidgetResource,
} from "./board-state";

const PLACEMENT = { dashboardId: "dash_1", gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };

function widget(id: string, overrides: Partial<WidgetResource> = {}): BoardItem {
  return {
    kind: "widget",
    resource: {
      id,
      name: `Widget ${id}`,
      definition: {
        version: 1,
        code: "export default () => null;",
        queries: [{ name: "traces", sql: "SELECT count() AS n FROM traces" }],
      },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      platformUrl: "https://app.test/dashboards",
      ...PLACEMENT,
      ...overrides,
    },
  };
}

function chart(id: string, overrides: Partial<ChartResource> = {}): BoardItem {
  return {
    kind: "chart",
    resource: {
      id,
      name: `Chart ${id}`,
      definition: { version: 1, sql: "SELECT 1", parameters: { model: "gpt-5-mini" } },
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      platformUrl: "https://app.test/dashboards",
      ...PLACEMENT,
      ...overrides,
    },
  };
}

function board(items: BoardItem[]): BoardSnapshot {
  return { dashboardId: "dash_1", items };
}

describe("diffBoards", () => {
  it("sorts every item into added, removed, changed or unchanged by id", () => {
    const before = board([widget("w1"), widget("w2"), chart("c1")]);
    const after = board([
      widget("w1"),
      widget("w2", { name: "Traffic by hour", updatedAt: "2026-10-13T00:00:00.000Z" }),
      widget("w3"),
    ]);

    const diff = diffBoards({ before, after });

    expect(diff.added.map((item) => item.resource.id)).toEqual(["w3"]);
    expect(diff.removed.map((item) => item.resource.id)).toEqual(["c1"]);
    expect(diff.changed.map(({ after: item }) => item.resource.name)).toEqual(["Traffic by hour"]);
    expect(diff.unchanged.map((item) => item.resource.id)).toEqual(["w1"]);
  });

  describe("when only a widget's query changes", () => {
    it("reports it as changed under the same id", () => {
      const edited = widget("w1");
      if (edited.kind !== "widget") throw new Error("fixture is a widget");
      edited.resource.definition.queries = [{ name: "traces", sql: "SELECT 2" }];

      const diff = diffBoards({ before: board([widget("w1")]), after: board([edited]) });

      expect(diff.changed).toHaveLength(1);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
    });
  });

  it("keeps a widget and a chart with the same id apart", () => {
    const diff = diffBoards({ before: board([widget("x")]), after: board([chart("x")]) });

    expect(diff.added.map((item) => item.kind)).toEqual(["chart"]);
    expect(diff.removed.map((item) => item.kind)).toEqual(["widget"]);
  });
});

describe("statementsOf", () => {
  describe("when the item is a widget", () => {
    it("gives one statement per named query, binding only declared defaults", () => {
      const item = widget("w1", {
        definition: {
          version: 1,
          code: "export default () => null;",
          queries: [
            {
              name: "by_model",
              sql: "SELECT count() FROM traces WHERE Model = {model:String}",
              parameters: [
                { name: "model", type: "string", default: "gpt-5-mini" },
                { name: "limit", type: "number" },
              ],
            },
            { name: "total", sql: "SELECT count() FROM traces" },
          ],
        },
      });

      expect(statementsOf(item)).toEqual([
        {
          itemId: "w1",
          kind: "widget",
          query: "by_model",
          sql: "SELECT count() FROM traces WHERE Model = {model:String}",
          parameters: { model: "gpt-5-mini" },
        },
        {
          itemId: "w1",
          kind: "widget",
          query: "total",
          sql: "SELECT count() FROM traces",
          parameters: {},
        },
      ]);
    });
  });

  describe("when the item is a chart", () => {
    it("gives its one statement with the values it was saved with", () => {
      expect(statementsOf(chart("c1"))).toEqual([
        {
          itemId: "c1",
          kind: "chart",
          query: "chart",
          sql: "SELECT 1",
          parameters: { model: "gpt-5-mini" },
        },
      ]);
    });
  });
});

describe("countOf", () => {
  function outcome(rows: Record<string, unknown>[] | null, query = "main"): QueryOutcome {
    return { itemId: "w_1", kind: "widget", query, rows, error: rows ? null : "refused" };
  }

  describe("when a statement returns one row per day", () => {
    it("sums the count column and reports how many rows carry it", () => {
      const rows = [
        { day: "2026-10-11", traces: "24" },
        { day: "2026-10-12", traces: "24" },
      ];

      expect(countOf([outcome(rows)])).toEqual({ total: 48, rows: 2 });
    });
  });

  describe("when a statement returns a single total", () => {
    it("reports one row, so a per-day ask can tell it apart", () => {
      expect(countOf([outcome([{ traces: 48 }])])).toEqual({ total: 48, rows: 1 });
    });
  });

  describe("when the first statement returns no rows", () => {
    it("takes a later statement that counts", () => {
      const counted = [{ day: "2026-10-11", n: 24 }];

      expect(countOf([outcome([], "empty"), outcome(counted, "per_day")])).toEqual({
        total: 24,
        rows: 1,
      });
    });
  });

  describe("when no statement counts", () => {
    it("reports zero when a statement ran and returned no rows", () => {
      expect(countOf([outcome(null), outcome([])])).toEqual({ total: 0, rows: 0 });
    });

    it("reports nothing when every statement was refused or had no number", () => {
      expect(countOf([outcome(null), outcome([{ label: "x" }])])).toBeNull();
    });
  });
});
