/**
 * What "Export CSV" writes for a widget: the rows its queries returned as one table, raw
 * numbers, ISO dates, the period on every row, and the file's name.
 * @see modules/analytics/specs/dashboard-widget-export.feature
 */

import type { ChartQueryResult } from "@langwatch/analytics-contract/chart-frame-protocol";
import { LWQL_MAX_RESULT_ROWS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import { describe, expect, it } from "vitest";

import {
  hitRowLimit,
  queryResultsTable,
  recordQueryExport,
  widgetExportFileName,
  widgetExportStatus,
  type WidgetQueryResults,
} from "../widget-export.ts";

/** 2026-10-01T00:00:00Z to 2026-10-08T00:00:00Z: seven whole UTC days. */
const PERIOD = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 9, 8) };

const answer = ({
  columns,
  rows,
  followsTimeWindow = true,
}: {
  columns: ChartQueryResult["columns"];
  rows: ChartQueryResult["rows"];
  followsTimeWindow?: boolean;
}): ChartQueryResult => ({
  columns,
  rows,
  statistics: {},
  diagnostics: [],
  followsTimeWindow,
  followsGranularity: false,
});

/** The results the host holds after each query answered once, in order. */
const resultsOf = (answers: Readonly<Record<string, ChartQueryResult>>): WidgetQueryResults =>
  Object.entries(answers).reduce<WidgetQueryResults>(
    (results, [queryName, result]) =>
      recordQueryExport({ results, queryName, result, period: PERIOD }),
    {},
  );

const BY_MODEL = answer({
  columns: [
    { name: "model", type: "String" },
    { name: "total_cost", type: "Nullable(Float64)" },
  ],
  rows: [
    { model: "gpt-5", total_cost: 830.12 },
    { model: "claude", total_cost: 12.5 },
    { model: "my-finetune-v2", total_cost: null },
  ],
});
const STAMP = ["2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z"];

describe("queryResultsTable", () => {
  describe("given one query that returned three rows", () => {
    /** @scenario "One row per result row, under the query's own column names" */
    it("writes a header and one row per result row, the query's name first", () => {
      const table = queryResultsTable(resultsOf({ main: BY_MODEL }));

      expect(table.fields).toEqual([
        "Query",
        "model",
        "total_cost",
        "Period start (UTC)",
        "Period end (UTC)",
      ]);
      expect(table.rows).toEqual([
        ["main", "gpt-5", 830.12, ...STAMP],
        ["main", "claude", 12.5, ...STAMP],
        ["main", "my-finetune-v2", "", ...STAMP],
      ]);
    });
  });

  describe("given two queries that returned different columns", () => {
    /** @scenario "Several queries go into one file" */
    it("names each row's query and leaves a column a query did not return empty", () => {
      const before = answer({
        columns: [
          { name: "model", type: "String" },
          { name: "traces", type: "UInt64" },
        ],
        rows: [{ model: "gpt-5", traces: "41" }],
      });

      const table = queryResultsTable(resultsOf({ now: BY_MODEL, before }));

      expect(table.fields.slice(0, 4)).toEqual(["Query", "model", "total_cost", "traces"]);
      expect(table.rows.map((row) => row.slice(0, 4))).toEqual([
        ["now", "gpt-5", 830.12, ""],
        ["now", "claude", 12.5, ""],
        ["now", "my-finetune-v2", "", ""],
        ["before", "gpt-5", "", "41"],
      ]);
    });
  });

  describe("given numbers and values that are missing", () => {
    /** @scenario "Numbers stay plain and a missing value stays empty" */
    it("keeps the numbers as they are and writes an empty cell for each missing value", () => {
      const result = answer({
        columns: [{ name: "value", type: "Nullable(Float64)" }],
        rows: [
          { value: 830.12 },
          { value: 12_000 },
          { value: 0 },
          { value: null },
          { value: Number.NaN },
          { value: "" },
          {},
        ],
      });

      const values = queryResultsTable(resultsOf({ main: result })).rows.map((row) => row[1]);

      expect(values).toEqual([830.12, 12_000, 0, "", "", "", ""]);
    });

    it("writes a flag as a word and a list as its JSON", () => {
      const result = answer({
        columns: [
          { name: "blocked", type: "Bool" },
          { name: "models", type: "Array(String)" },
        ],
        rows: [{ blocked: true, models: ["gpt-5", "claude"] }],
      });

      expect(queryResultsTable(resultsOf({ main: result })).rows[0]?.slice(1, 3)).toEqual([
        "true",
        '["gpt-5","claude"]',
      ]);
    });
  });

  describe("given date and time columns", () => {
    /** @scenario "Dates are ISO instants in UTC" */
    it("writes ISO instants in UTC, and leaves another zone's text as the query returned it", () => {
      const result = answer({
        columns: [
          { name: "bucket", type: "DateTime" },
          { name: "day", type: "Nullable(Date)" },
          { name: "at", type: "DateTime64(3, 'UTC')" },
          { name: "local", type: "DateTime('Europe/Amsterdam')" },
          { name: "note", type: "String" },
        ],
        rows: [
          {
            bucket: "2026-10-01 00:00:00",
            day: "2026-10-01",
            at: "2026-10-01 13:05:09.250",
            local: "2026-10-01 02:00:00",
            note: "2026-10-01 00:00:00",
          },
        ],
      });

      expect(queryResultsTable(resultsOf({ main: result })).rows[0]?.slice(1, 6)).toEqual([
        "2026-10-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
        "2026-10-01T13:05:09.250Z",
        "2026-10-01 02:00:00",
        "2026-10-01 00:00:00",
      ]);
    });
  });

  describe("given a query that follows the board's period and one that reads outside it", () => {
    /** @scenario "Every row carries the period it was read over" */
    it("stamps the first with the period's instants and leaves the second's empty", () => {
      const everSent = answer({
        columns: [{ name: "ever", type: "UInt8" }],
        rows: [{ ever: 1 }],
        followsTimeWindow: false,
      });

      const table = queryResultsTable(resultsOf({ main: BY_MODEL, everSent }));

      expect(table.fields.slice(-2)).toEqual(["Period start (UTC)", "Period end (UTC)"]);
      expect(table.rows.map((row) => row.slice(-2))).toEqual([STAMP, STAMP, STAMP, ["", ""]]);
    });
  });
});

describe("widgetExportFileName", () => {
  /** @scenario "The file is named for the board, the widget and the period's days" */
  it("names the board, the widget and the first and last UTC day of the period", () => {
    expect(
      widgetExportFileName({
        board: "Running costs",
        widget: "Spend",
        results: resultsOf({ main: BY_MODEL }),
      }),
    ).toBe("running-costs_spend_query-results_2026-10-01_2026-10-07.csv");
  });

  /** @scenario "The file is named for the board, the widget and the period's days" */
  it("leaves the days out when no query ran over the board's period", () => {
    const everSent = answer({ columns: [], rows: [{}], followsTimeWindow: false });

    expect(
      widgetExportFileName({
        board: "Can I trust my numbers?",
        widget: "Is my data complete?",
        results: resultsOf({ everSent }),
      }),
    ).toBe("can-i-trust-my-numbers_is-my-data-complete_query-results.csv");
  });

  it("still names a file when a name has no letter or digit to keep", () => {
    expect(widgetExportFileName({ board: "???", widget: "!!!", results: {} })).toBe(
      "board_widget_query-results.csv",
    );
  });
});

describe("widgetExportStatus", () => {
  const withRows = resultsOf({ main: BY_MODEL });
  const noRows = resultsOf({ main: answer({ columns: [], rows: [] }) });

  /** @scenario "A widget with nothing of its own to export has no Export CSV" */
  it.each([
    ["has no query", { face: "chart", hasQueries: false, results: {} }],
    ["shows its setup view", { face: "missing", hasQueries: true, results: withRows }],
    ["may not be seen by the reader", { face: "no_access", hasQueries: true, results: withRows }],
  ] as const)("is hidden for a widget that %s", (_case, input) => {
    expect(widgetExportStatus(input)).toBe("hidden");
  });

  /** @scenario "A widget with nothing of its own to export has no Export CSV" */
  it("is empty when every query returned no rows, or the period has no traffic", () => {
    expect(widgetExportStatus({ face: "chart", hasQueries: true, results: noRows })).toBe("empty");
    expect(widgetExportStatus({ face: "no_traffic", hasQueries: true, results: noRows })).toBe(
      "empty",
    );
  });

  it("is loading until a query answers, failed when the widget failed, then ready", () => {
    expect(widgetExportStatus({ face: "chart", hasQueries: true, results: {} })).toBe("loading");
    expect(widgetExportStatus({ face: "failed", hasQueries: true, results: {} })).toBe("failed");
    expect(widgetExportStatus({ face: "chart", hasQueries: true, results: withRows })).toBe(
      "ready",
    );
  });
});

describe("hitRowLimit", () => {
  it("is true only when a query returned as many rows as one request may", () => {
    const full = answer({
      columns: [{ name: "n", type: "UInt64" }],
      rows: Array.from({ length: LWQL_MAX_RESULT_ROWS }, (_, n) => ({ n })),
    });

    expect(hitRowLimit(resultsOf({ main: full }))).toBe(true);
    expect(hitRowLimit(resultsOf({ main: BY_MODEL }))).toBe(false);
  });
});
