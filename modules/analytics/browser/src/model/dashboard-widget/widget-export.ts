/**
 * A widget's "Export CSV": the rows its own queries last returned, as one table. The host holds
 * every result and the server checked each one for the reader, so an export never holds more
 * than the widget could show. The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import type { ChartQueryResult } from "@langwatch/analytics-contract/chart-frame-protocol";
import { LWQL_MAX_RESULT_ROWS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import { slugify } from "@langwatch/design-system/slugify";
import { Temporal } from "@langwatch/time";

import type { WidgetFace } from "./widget-completeness.ts";

/** A period in epoch milliseconds; the end is the first instant after it. */
export interface WidgetExportPeriod {
  readonly start: number;
  readonly end: number;
}

/** One query's last answer, as the host keeps it for an export. */
export interface WidgetQueryResult {
  readonly columns: ChartQueryResult["columns"];
  readonly rows: ChartQueryResult["rows"];
  /** The board's period the query ran over; absent when the query does not follow it. */
  readonly period?: WidgetExportPeriod;
}

/** Each query's last answer, by query name, in the order the queries first answered. */
export type WidgetQueryResults = Readonly<Record<string, WidgetQueryResult>>;

/** A result kept for export, stamped with the period it ran over when it follows one. */
export function recordQueryExport({
  results,
  queryName,
  result,
  period,
}: {
  results: WidgetQueryResults;
  queryName: string;
  result: ChartQueryResult;
  period: WidgetExportPeriod;
}): WidgetQueryResults {
  const { columns, rows, followsTimeWindow } = result;
  return {
    ...results,
    [queryName]: { columns, rows, ...(followsTimeWindow ? { period } : {}) },
  };
}

/**
 * Where a widget is when the reader opens its menu. `hidden` has nothing of its own to export:
 * no query, a setup view, or data the reader may not see.
 */
export type WidgetExportStatus = "hidden" | "loading" | "failed" | "empty" | "ready";

/** What the frame hands its card for "Export CSV". */
export interface WidgetExport {
  readonly status: WidgetExportStatus;
  readonly results: WidgetQueryResults;
}

export const NO_WIDGET_EXPORT: WidgetExport = { status: "hidden", results: {} };

export function widgetExportStatus({
  face,
  hasQueries,
  results,
}: {
  face: WidgetFace["kind"];
  hasQueries: boolean;
  results: WidgetQueryResults;
}): WidgetExportStatus {
  if (!hasQueries) return "hidden";
  if (face === "failed") return "failed";
  if (face === "no_traffic") return "empty";
  // The setup view and "no access" draw none of the widget's data, so there is none to export.
  if (face !== "chart") return "hidden";
  const answered = Object.values(results);
  if (answered.length === 0) return "loading";
  return answered.some((result) => result.rows.length > 0) ? "ready" : "empty";
}

/** Why "Export CSV" cannot be picked yet, in the menu's words. */
export const EXPORT_UNAVAILABLE_REASON: Readonly<
  Record<Exclude<WidgetExportStatus, "hidden" | "ready">, string>
> = {
  loading: "Still loading",
  failed: "This widget did not load",
  empty: "No data in this period",
};

const PERIOD_FIELDS = ["Period start (UTC)", "Period end (UTC)"] as const;

/** ClickHouse's text for a Date, DateTime or DateTime64 value. */
const CLICKHOUSE_TIME = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?)?$/;
/** A date or time column whose text is UTC: no zone named, or UTC named. */
const UTC_TIME_TYPE = /\b(?:Date|Date32|DateTime|DateTime64)\b(?!.*'(?!UTC')[^']+')/;

const isoInstant = (epochMs: number): string =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toString();

/** "2026-10-01 00:00:00.000" as "2026-10-01T00:00:00Z"; text that is no ClickHouse time stays. */
function isoUtc(text: string): string {
  const match = CLICKHOUSE_TIME.exec(text.trim());
  if (!match) return text;
  const [, day, time = "00:00:00", fraction = ""] = match;
  return `${day}T${time}${/[1-9]/.test(fraction) ? `.${fraction}` : ""}Z`;
}

/** One value as the file holds it: raw, and empty when there is none, never 0. */
function cellOf({ value, type }: { value: unknown; type: string }): string | number {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "string") return UTC_TIME_TYPE.test(type) ? isoUtc(value) : value;
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value) ?? "";
}

/** A CSV table: its header row and its rows. */
export interface WidgetExportTable {
  readonly fields: string[];
  readonly rows: (string | number)[][];
}

/**
 * Every query's rows in one table: the query's name, then the union of the queries' own column
 * names unchanged, then the period each query ran over. One row per result row, in the order
 * returned; a column a query did not return is empty on its rows.
 */
export function queryResultsTable(results: WidgetQueryResults): WidgetExportTable {
  const queries = Object.entries(results);
  const names = [...new Set(queries.flatMap(([, { columns }]) => columns.map(({ name }) => name)))];
  return {
    fields: ["Query", ...names, ...PERIOD_FIELDS],
    rows: queries.flatMap(([queryName, { columns, rows, period }]) => {
      const types = new Map(columns.map(({ name, type }) => [name, type]));
      const stamp = period ? [isoInstant(period.start), isoInstant(period.end)] : ["", ""];
      return rows.map((row) => [
        queryName,
        ...names.map((name) => {
          const type = types.get(name);
          return type === undefined ? "" : cellOf({ value: row[name], type });
        }),
        ...stamp,
      ]);
    }),
  };
}

/** What the reader is told with a file that may be cut short: "... the 10,000-row limit ...". */
export const ROW_LIMIT_NOTICE = `A query hit the ${LWQL_MAX_RESULT_ROWS.toLocaleString("en-US")}-row limit, so rows may be missing.`;

/** Whether a query returned as many rows as one request may, so more may exist. */
export function hitRowLimit(results: WidgetQueryResults): boolean {
  return Object.values(results).some((result) => result.rows.length >= LWQL_MAX_RESULT_ROWS);
}

const utcDay = (epochMs: number): string => isoInstant(epochMs).slice(0, 10);

/**
 * "running-costs_spend_query-results_2026-10-01_2026-10-07.csv": the days are in UTC and the
 * last one is the last day the period includes. A widget with no query over the board's period
 * has no days to name.
 */
export function widgetExportFileName({
  board,
  widget,
  results,
}: {
  board: string;
  widget: string;
  results: WidgetQueryResults;
}): string {
  const period = Object.values(results).find((result) => result.period)?.period;
  const days = period ? [utcDay(period.start), utcDay(period.end - 1)] : [];
  const parts = [slugify(board) || "board", slugify(widget) || "widget", "query-results", ...days];
  return `${parts.join("_")}.csv`;
}
