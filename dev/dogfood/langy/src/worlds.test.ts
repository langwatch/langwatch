import { describe, expect, it } from "vitest";

import { parseWorld } from "./world-names.ts";
import { buildFacts, dailyWindows, digest, totalOf, type Item, type WorldState } from "./worlds.ts";

const widget = (
  id: string,
  dashboardId: string | null,
  extra: Record<string, unknown> = {},
): Item => ({
  kind: "widget",
  resource: { id, name: `widget ${id}`, dashboardId, ...extra },
});

const stateWith = (items: Item[], overrides: Partial<WorldState> = {}): WorldState => ({
  world: "D2",
  tag: "abc123",
  trace_name: "checkout-abc123",
  seeded_traces: 48,
  expected_total: 48,
  expected_days: 2,
  window: { start: 0, end: 1 },
  board: {
    id: "board-1",
    name: "Checkout health abc123",
    widgets: [
      { id: "w1", name: "widget w1" },
      { id: "w2", name: "widget w2" },
    ],
  },
  target_widget: { id: "w1", name: "widget w1" },
  baseline_item_ids: items.map((item) => item.resource.id),
  initial_digests: Object.fromEntries(
    items.map((item) => [item.resource.id, digest({ resource: item.resource })]),
  ),
  baseline_alert_ids: ["old-alert"],
  ...overrides,
});

describe("parseWorld", () => {
  it("takes the default world when the parameter is empty", () => {
    expect(parseWorld({ value: undefined })).toBe("prompt_and_traces");
    expect(parseWorld({ value: "  " })).toBe("prompt_and_traces");
  });

  it("takes a matrix row by name", () => {
    expect(parseWorld({ value: "X1" })).toBe("X1");
    expect(parseWorld({ value: "B1" })).toBe("B1");
    expect(parseWorld({ value: "T1" })).toBe("T1");
    expect(parseWorld({ value: "W1" })).toBe("W1");
  });

  it("refuses an unknown world and names the valid ones", () => {
    expect(() => parseWorld({ value: "Z9" })).toThrow(/unknown world "Z9".*D1/);
  });
});

describe("buildFacts", () => {
  const initial = [
    widget("w1", "board-1"),
    widget("w2", "board-1"),
    widget("elsewhere", "other-board"),
  ];

  it("reports an untouched board as unchanged", () => {
    const facts = buildFacts({ items: initial, alerts: [], state: stateWith(initial) });

    expect(facts.board).toMatchObject({
      items: 2,
      added: [],
      changed_ids: [],
      removed_names: [],
      unchanged: true,
    });
    expect(facts.items_created_this_run).toBe(0);
    expect(facts.target_widget).toEqual({ exists: true, same_id_changed: false });
    expect(facts.other_widgets_unchanged).toBe(true);
  });

  it("sees the target edited in place and the other widget left alone", () => {
    const state = stateWith(initial);
    const edited = [
      widget("w1", "board-1", { definition: { sql: "SELECT 1" } }),
      initial[1]!,
      initial[2]!,
    ];

    const facts = buildFacts({ items: edited, alerts: [], state });

    expect(facts.board?.changed_ids).toEqual(["w1"]);
    expect(facts.target_widget).toEqual({ exists: true, same_id_changed: true });
    expect(facts.other_widgets_unchanged).toBe(true);
  });

  it("counts a widget added to the board and one created off it with the run tag", () => {
    const state = stateWith(initial);
    const now = [
      ...initial,
      widget("new-on", "board-1"),
      widget("new-off", null, { definition: { sql: "checkout-abc123" } }),
    ];

    const facts = buildFacts({ items: now, alerts: [], state });

    expect(facts.board?.added).toEqual([{ kind: "widget", name: "widget new-on" }]);
    expect(facts.created_off_board).toEqual([{ kind: "widget", name: "widget new-off" }]);
    expect(facts.items_created_this_run).toBe(2);
  });

  it("lists only the alerts that name the target widget", () => {
    const facts = buildFacts({
      items: initial,
      alerts: [
        { kind: "trigger", id: "on-target", name: "a", raw: { widgetId: "w1" } },
        { kind: "trigger", id: "elsewhere", name: "b", raw: { widgetId: "w2" } },
      ],
      state: stateWith(initial),
    });

    expect(facts.alerts_on_target).toEqual([{ kind: "trigger", id: "on-target", name: "a" }]);
  });

  it("names a deleted widget and reports the target gone", () => {
    const facts = buildFacts({
      items: [initial[1]!, initial[2]!],
      alerts: [],
      state: stateWith(initial),
    });

    expect(facts.board?.removed_names).toEqual(["widget w1"]);
    expect(facts.target_widget?.exists).toBe(false);
  });

  it("keeps only new alerts that carry this run's tag", () => {
    const facts = buildFacts({
      items: initial,
      alerts: [
        { kind: "trigger", id: "old-alert", name: "old", raw: { name: "checkout-abc123" } },
        { kind: "trigger", id: "other-run", name: "theirs", raw: { name: "checkout-zzz999" } },
        {
          kind: "monitor",
          id: "ours",
          name: "mine",
          raw: { query: "TraceName = 'checkout-abc123'" },
        },
      ],
      state: stateWith(initial),
    });

    expect(facts.new_alerts).toEqual([{ kind: "monitor", id: "ours", name: "mine" }]);
  });

  it("keeps a new alert on a graph pinned to the run's board, which names the graph, not the tag", () => {
    const graph: Item = {
      kind: "graph",
      resource: { id: "graph-9", name: "Volume", dashboardId: "board-1" },
    };

    const facts = buildFacts({
      items: [...initial, graph],
      alerts: [
        { kind: "trigger", id: "t-9", name: "Volume alert", raw: { customGraphId: "graph-9" } },
      ],
      state: stateWith(initial),
    });

    expect(facts.board?.added).toEqual([{ kind: "graph", name: "Volume" }]);
    expect(facts.new_alerts).toEqual([{ kind: "trigger", id: "t-9", name: "Volume alert" }]);
  });
});

describe("digest", () => {
  it("ignores key order", () => {
    expect(digest({ resource: { a: 1, b: { c: 2, d: 3 } } })).toBe(
      digest({ resource: { b: { d: 3, c: 2 }, a: 1 } }),
    );
  });
});

describe("totalOf", () => {
  it("sums the count column and skips the time bucket", () => {
    expect(
      totalOf({
        rows: [
          { day: "2026-10-14", traces: "24" },
          { day: "2026-10-15", traces: 24 },
        ],
      }),
    ).toBe(48);
  });

  it("prefers a count-like column over another number", () => {
    expect(totalOf({ rows: [{ avg_ms: 900, trace_count: 3 }] })).toBe(3);
  });

  it("gives null without a numeric column", () => {
    expect(totalOf({ rows: [{ name: "x" }] })).toBeNull();
    expect(totalOf({ rows: [] })).toBeNull();
  });
});

describe("dailyWindows", () => {
  it("gives the two full UTC days before today", () => {
    const now = Date.parse("2026-10-16T10:20:00Z");
    const { previous, day } = dailyWindows({ nowMs: now });

    expect(new Date(previous.start).toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(previous.end).toBe(day.start);
    expect(new Date(day.end).toISOString()).toBe("2026-10-16T00:00:00.000Z");
  });
});
