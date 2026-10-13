import { describe, expect, it } from "vitest";

import {
  type BoardItem,
  type BoardSnapshot,
  type ChartResource,
  diffBoards,
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
