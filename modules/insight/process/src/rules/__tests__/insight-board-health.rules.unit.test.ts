/**
 * @vitest-environment node
 * The board check's pure rules: how a result and a failure read, when a widget is broken,
 * which cards a run writes and when a card is resolved.
 * @see modules/insight/specs/insight-board-health.feature
 */

import { HandledError } from "@langwatch/handled-error";
import type { InsightEntry } from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  boardHealthCards,
  type BrokenWidget,
  classifyStatementFailure,
  decideBoardHealthActs,
  isPlatformWide,
  readResult,
  type StatementOutcome,
  statementParameters,
  widgetHealth,
} from "../insight-board-health.rules.ts";

class Refusal extends HandledError {}

function refusal({
  code,
  httpStatus,
  fault,
}: {
  code: string;
  httpStatus: number;
  fault?: "customer" | "platform" | "provider";
}): HandledError {
  return new Refusal(code, `refused: ${code}`, { httpStatus, ...(fault ? { fault } : {}) });
}

const DAY_MS = 86_400_000;
const SLOT = Date.UTC(2026, 9, 19, 9, 12);
const BOARD_ID = "dashboard-1";

function card(entry: Partial<InsightEntry> = {}): InsightEntry {
  return {
    id: "insight_health_old",
    title: '"Errors" fails to load',
    body: "refused",
    tone: "bad",
    topic: "health",
    validDays: 3,
    lwql: null,
    replay: null,
    source: null,
    board: { id: BOARD_ID, name: "Costs", widget: { id: "widget-1", name: "Errors" } },
    filedVia: "run",
    ownerUserId: "user-1",
    filedByUserId: null,
    findingKey: "board-health:widget-1:error",
    filedAt: SLOT - DAY_MS,
    renewedAt: null,
    seenAt: null,
    archivedAt: null,
    keptAt: null,
    ...entry,
  };
}

const broken = (id: string, reason: BrokenWidget["reason"] = "no_data"): BrokenWidget => ({
  widget: { id, name: `Widget ${id}` },
  reason,
});

describe("given a statement's result", () => {
  /** @scenario "A widget whose every statement comes back empty shows no data" */
  it.each([
    ["no rows", { rows: [] }],
    ["rows whose every value is null", { rows: [{ a: null, b: null }, { a: null }] }],
    [
      "one row of zeros beside a report of no traffic",
      { rows: [{ count: 0, total: "0", avg: null }], completeness: { state: "no_traffic" } },
    ],
    [
      "a report of no traffic",
      { rows: [{ count: 0 }, { count: 0 }], completeness: { state: "no_traffic" } },
    ],
  ])("reads %s as empty", (_shape, result) => {
    expect(readResult(result)).toEqual({ kind: "empty" });
  });

  /** @scenario "A zero with no report of no traffic is not checked" */
  it.each([
    ["no report, as from a rollup view or a failed report", { rows: [{ errors: 0 }] }],
    [
      "a report of traffic",
      { rows: [{ count: 0, total: "0" }], completeness: { state: "complete" } },
    ],
    ["a report of partial traffic", { rows: [{ count: 0 }], completeness: { state: "partial" } }],
  ])("reads one row of zeros beside %s as unchecked", (_shape, result) => {
    expect(readResult(result)).toEqual({ kind: "unchecked" });
  });

  it("reads several rows of zeros and a non-zero row as data", () => {
    expect(readResult({ rows: [{ count: 0 }, { count: 0 }] })).toEqual({ kind: "data" });
    expect(readResult({ rows: [{ count: 3 }] })).toEqual({ kind: "data" });
  });
});

describe("given a widget's statements", () => {
  /** @scenario "A widget whose every statement comes back empty shows no data" */
  it("shows no data only when every statement ran and came back empty", () => {
    expect(widgetHealth([{ kind: "empty" }, { kind: "empty" }])).toBe("no_data");
    expect(widgetHealth([{ kind: "empty" }, { kind: "data" }])).toBe("healthy");
    expect(widgetHealth([{ kind: "empty" }, { kind: "unchecked" }])).toBe("unchecked");
    expect(widgetHealth([])).toBe("unchecked");
  });

  /** @scenario "An error and an empty statement on one widget file one error card" */
  it("reads an error over an empty statement and over a failure of ours", () => {
    const error: StatementOutcome = { kind: "error", code: "lwql_not_permitted", message: "no" };
    expect(widgetHealth([error, { kind: "empty" }])).toBe("error");
    expect(widgetHealth([{ kind: "platform", code: "lwql_busy" }, error])).toBe("error");
    expect(widgetHealth([{ kind: "platform", code: "lwql_busy" }, { kind: "empty" }])).toBe(
      "platform",
    );
    const cards = boardHealthCards({
      boardId: BOARD_ID,
      broken: [
        { ...broken("widget-1", "error"), failure: { code: "lwql_not_permitted", message: "no" } },
      ],
    });
    expect(cards.map(({ key }) => key)).toEqual(["board-health:widget-1:error"]);
  });

  it("runs a statement with each parameter's default, and none whose parameter has no default", () => {
    expect(
      statementParameters({ sql: "q", parameters: [{ name: "model", default: "gpt" }] }),
    ).toEqual({ runnable: true, values: { model: "gpt" } });
    expect(statementParameters({ sql: "q" })).toEqual({ runnable: true, values: {} });
    expect(statementParameters({ sql: "q", parameters: [{ name: "model" }] })).toEqual({
      runnable: false,
    });
  });
});

describe("given a failure of a statement", () => {
  /** @scenario "A failure the person cannot fix files nothing" */
  it.each([
    refusal({ code: "lwql_unavailable", httpStatus: 503, fault: "platform" }),
    refusal({ code: "lwql_provisioning_incomplete", httpStatus: 503, fault: "platform" }),
    refusal({ code: "lwql_app_function_unavailable", httpStatus: 503 }),
    refusal({ code: "lwql_app_function_hydration_failed", httpStatus: 502 }),
    refusal({ code: "lwql_busy", httpStatus: 503 }),
    refusal({ code: "clickhouse_unavailable", httpStatus: 503, fault: "platform" }),
    refusal({ code: "query_timeout", httpStatus: 504 }),
    refusal({ code: "query_memory_exceeded", httpStatus: 422 }),
    refusal({ code: "query_scan_limit_exceeded", httpStatus: 422 }),
    new Error("socket hang up"),
  ])("reads %s as the platform's", (error) => {
    expect(classifyStatementFailure(error).kind).toBe("platform");
  });

  it("reads a refusal the person can fix as an error, with its code and message", () => {
    expect(
      classifyStatementFailure(refusal({ code: "lwql_unknown_identifier", httpStatus: 400 })),
    ).toEqual({
      kind: "error",
      code: "lwql_unknown_identifier",
      message: "refused: lwql_unknown_identifier",
    });
  });

  it("reads Workbench off, a full window and a missing parameter as no verdict", () => {
    expect(
      classifyStatementFailure(refusal({ code: "lwql_not_enabled", httpStatus: 403 })),
    ).toEqual({ kind: "off" });
    const full = new Refusal("lwql_rate_limited", "full", {
      httpStatus: 429,
      fault: "customer",
      meta: { retryAfterSeconds: 20 },
    });
    expect(classifyStatementFailure(full)).toEqual({ kind: "window_full", retryAfterSeconds: 20 });
    expect(
      classifyStatementFailure(refusal({ code: "lwql_parameter_missing", httpStatus: 400 })),
    ).toEqual({ kind: "unchecked" });
  });

  /** @scenario "When most statements fail with the same code, the whole check is the platform's" */
  it("reads one code failing at least 3 and most of what ran as the platform's", () => {
    const failing: StatementOutcome = {
      kind: "error",
      code: "lwql_unknown_identifier",
      message: "",
    };
    expect(isPlatformWide([failing, failing, failing, { kind: "data" }])).toBe(true);
    expect(isPlatformWide([failing, failing, { kind: "data" }])).toBe(false);
    expect(isPlatformWide([failing, failing, failing, ...Array(3).fill({ kind: "data" })])).toBe(
      false,
    );
    expect(isPlatformWide([failing, failing, failing, { kind: "unchecked" }])).toBe(true);
  });
});

describe("given more broken widgets than the cap", () => {
  /** @scenario "More than 5 broken widgets file 4 cards and one that lists the rest" */
  it("files 4 cards in board order and one that names the other 3", () => {
    const widgets = ["1", "2", "3", "4", "5", "6", "7"].map((id) =>
      broken(`widget-${id}`, id === "6" ? "error" : "no_data"),
    );

    const cards = boardHealthCards({ boardId: BOARD_ID, broken: widgets });

    expect(cards.map(({ key }) => key)).toEqual([
      "board-health:widget-1:no_data",
      "board-health:widget-2:no_data",
      "board-health:widget-3:no_data",
      "board-health:widget-4:no_data",
      "board-health:more:dashboard-1",
    ]);
    const rest = cards.at(-1);
    expect(rest).toMatchObject({ title: "3 more widgets on this board need a look", tone: "bad" });
    expect(rest?.widget).toBeNull();
    for (const id of ["5", "6", "7"]) expect(rest?.body).toContain(`"Widget widget-${id}"`);
    expect(boardHealthCards({ boardId: BOARD_ID, broken: widgets.slice(0, 5) })).toHaveLength(5);
  });

  it("writes no web address into a card, whatever the refusal said", () => {
    const [errorCard] = boardHealthCards({
      boardId: BOARD_ID,
      broken: [
        {
          ...broken("widget-1", "error"),
          failure: {
            code: "lwql_invalid_query",
            message: "see https://example.test/x or www.example.test",
          },
        },
      ],
    });

    expect(errorCard?.body).toContain("`lwql_invalid_query`");
    expect(errorCard?.body).not.toMatch(/https?:|www\./);
  });
});

describe("given a card the check filed before", () => {
  const [errorCard] = boardHealthCards({
    boardId: BOARD_ID,
    broken: [
      { ...broken("widget-1", "error"), failure: { code: "lwql_invalid_query", message: "" } },
    ],
  });
  const decide = (existing: InsightEntry[]) =>
    decideBoardHealthActs({
      cards: errorCard ? [errorCard] : [],
      existing,
      boardId: BOARD_ID,
      slot: SLOT,
      insightIdOf: () => "insight_health_today",
    });

  /** @scenario "A card nobody renewed for its 3 days is resolved, and the next break files a new one" */
  it("files a new card once the old one's 3 days ran out, and renews one that has days left", () => {
    expect(decide([card({ filedAt: SLOT - 3 * DAY_MS })])).toEqual([
      expect.objectContaining({ kind: "file", insightId: "insight_health_today" }),
    ]);
    expect(decide([card({ filedAt: SLOT - 5 * DAY_MS, renewedAt: SLOT - DAY_MS })])).toEqual([
      expect.objectContaining({
        kind: "renew",
        insight: expect.objectContaining({ id: "insight_health_old" }),
      }),
    ]);
    expect(decide([card({ filedAt: SLOT - 9 * DAY_MS, keptAt: SLOT - 8 * DAY_MS })])).toEqual([
      expect.objectContaining({ kind: "renew" }),
    ]);
  });

  it("renews one marked done that has days left, and files a new card for one that ran out", () => {
    expect(decide([card({ archivedAt: SLOT - 1 })])).toEqual([
      expect.objectContaining({ kind: "renew" }),
    ]);
    expect(decide([card({ archivedAt: SLOT - 1, filedAt: SLOT - 4 * DAY_MS })])).toEqual([
      expect.objectContaining({ kind: "file" }),
    ]);
  });

  /** @scenario "A card filed by a run asked for after the scheduled slot is still found" */
  it("renews a card filed later than the run's slot", () => {
    expect(decide([card({ filedAt: SLOT + 2 * 3_600_000 })])).toEqual([
      expect.objectContaining({ kind: "renew" }),
    ]);
  });

  it("files again under its own id on a retry, and ignores another board's card", () => {
    expect(decide([card({ id: "insight_health_today", filedAt: SLOT })])).toEqual([
      expect.objectContaining({ kind: "file", insightId: "insight_health_today" }),
    ]);
    const elsewhere = card({ board: { id: "dashboard-2", name: "Other", widget: null } });
    expect(decide([elsewhere])).toEqual([expect.objectContaining({ kind: "file" })]);
  });
});
