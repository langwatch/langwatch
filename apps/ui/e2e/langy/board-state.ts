/**
 * What is on a board, read through the public REST routes: its widgets and
 * saved charts, a diff of two reads, and each item's query run through
 * `POST /api/v1/query`. The dashboards scenarios' code check before the judge.
 */

import { CONFIG } from "./config";
import { lwGet, lwPost } from "./langwatch-api";
import type { TimeWindow } from "./traffic-pattern";

type ParameterValue = string | number | boolean;

/** Where a board item sits on the grid; `dashboardId` is null until it is placed. */
interface Placement {
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

/** One named LangWatchQL statement a widget runs, with its declared parameters. */
export interface WidgetQuery {
  name: string;
  sql: string;
  parameters?: { name: string; type: string; default?: ParameterValue }[];
}

/** A dashboard widget as `GET .../analytics/dashboard-widgets` publishes it. */
export interface WidgetResource extends Placement {
  id: string;
  name: string;
  definition: {
    version: number;
    code: string;
    queries: WidgetQuery[];
    description?: string;
    prompt?: string;
    source?: { kind: string };
  };
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

/** A saved workbench chart as `GET .../analytics/charts` publishes it. */
export interface ChartResource extends Placement {
  id: string;
  name: string;
  definition: {
    version: number;
    sql: string;
    parameters: Record<string, ParameterValue>;
    vegaLiteSpec?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

export type BoardItem =
  | { kind: "widget"; resource: WidgetResource }
  | { kind: "chart"; resource: ChartResource };

/** Everything on one dashboard at the moment it was read. */
export interface BoardSnapshot {
  dashboardId: string;
  items: BoardItem[];
}

/** The widgets route, for the current project. */
export function dashboardWidgetsPath(): string {
  return `/api/v1/projects/${CONFIG.PROJECT_ID}/analytics/dashboard-widgets`;
}

function chartsPath(): string {
  return `/api/v1/projects/${CONFIG.PROJECT_ID}/analytics/charts`;
}

/** Every widget and saved chart in the project, placed on a board or not. */
export async function countProjectItems(): Promise<number> {
  const [widgets, charts] = await Promise.all([
    lwGet(dashboardWidgetsPath()) as Promise<{ data: WidgetResource[] }>,
    lwGet(chartsPath()) as Promise<{ data: ChartResource[] }>,
  ]);
  return widgets.data.length + charts.data.length;
}

/** Both lists are project-wide; only the items placed on this dashboard are kept. */
export async function readBoard({ dashboardId }: { dashboardId: string }): Promise<BoardSnapshot> {
  const [widgets, charts] = await Promise.all([
    lwGet(dashboardWidgetsPath()) as Promise<{ data: WidgetResource[] }>,
    lwGet(chartsPath()) as Promise<{ data: ChartResource[] }>,
  ]);
  return {
    dashboardId,
    items: [
      ...widgets.data
        .filter((widget) => widget.dashboardId === dashboardId)
        .map((resource): BoardItem => ({ kind: "widget", resource })),
      ...charts.data
        .filter((chart) => chart.dashboardId === dashboardId)
        .map((resource): BoardItem => ({ kind: "chart", resource })),
    ],
  };
}

/** How a board moved between two reads, matched on kind and id. */
export interface BoardDiff {
  added: BoardItem[];
  removed: BoardItem[];
  /** Same id, any byte of the published resource different. */
  changed: { before: BoardItem; after: BoardItem }[];
  unchanged: BoardItem[];
}

/** Compares two reads of one board, item by item. */
export function diffBoards({
  before,
  after,
}: {
  before: BoardSnapshot;
  after: BoardSnapshot;
}): BoardDiff {
  const key = (item: BoardItem): string => `${item.kind}:${item.resource.id}`;
  const earlier = new Map(before.items.map((item) => [key(item), item]));
  const later = new Map(after.items.map((item) => [key(item), item]));
  const diff: BoardDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const [id, item] of later) {
    const previous = earlier.get(id);
    if (!previous) diff.added.push(item);
    else if (JSON.stringify(previous.resource) === JSON.stringify(item.resource)) {
      diff.unchanged.push(item);
    } else diff.changed.push({ before: previous, after: item });
  }
  for (const [id, item] of earlier) {
    if (!later.has(id)) diff.removed.push(item);
  }
  return diff;
}

/** One statement a board item runs, with the values it binds. */
export interface BoardStatement {
  itemId: string;
  kind: BoardItem["kind"];
  /** The widget query's name; `chart` for a chart's single statement. */
  query: string;
  sql: string;
  parameters: Record<string, ParameterValue>;
}

/**
 * A widget binds each declared parameter's default, as its Run button does; a
 * chart binds the values it was saved with. The reserved period parameters
 * come from the time window, never from here.
 */
export function statementsOf(item: BoardItem): BoardStatement[] {
  if (item.kind === "chart") {
    const { sql, parameters } = item.resource.definition;
    return [{ itemId: item.resource.id, kind: "chart", query: "chart", sql, parameters }];
  }
  return item.resource.definition.queries.map((query) => ({
    itemId: item.resource.id,
    kind: "widget",
    query: query.name,
    sql: query.sql,
    parameters: Object.fromEntries(
      (query.parameters ?? []).flatMap((declared) =>
        declared.default === undefined ? [] : [[declared.name, declared.default]],
      ),
    ),
  }));
}

/** A statement's rows, or the refusal it got. */
export interface QueryOutcome extends Omit<BoardStatement, "sql" | "parameters"> {
  rows: Record<string, unknown>[] | null;
  error: string | null;
}

/**
 * Runs every statement on the board over `window`, narrowed to the current
 * project. A refused statement is an outcome, not a throw: a widget whose
 * query fails is itself what a scenario asserts on.
 */
export async function runBoardQueries({
  snapshot,
  window,
  granularitySeconds,
}: {
  snapshot: BoardSnapshot;
  window: TimeWindow;
  /** Fills `dashboard_context_granularity_seconds`, as a board's grain picker does. */
  granularitySeconds?: number;
}): Promise<QueryOutcome[]> {
  const timeWindow = {
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
  };
  return Promise.all(
    snapshot.items.flatMap(statementsOf).map(async ({ sql, parameters, ...statement }) => {
      try {
        const result = (await lwPost({
          path: "/api/v1/query",
          body: { sql, parameters, timeWindow, granularitySeconds, projectId: CONFIG.PROJECT_ID },
        })) as { rows: Record<string, unknown>[] };
        return { ...statement, rows: result.rows, error: null };
      } catch (error) {
        return {
          ...statement,
          rows: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/** What an item counts: the sum of its count column, and how many rows carry it. */
export interface Count {
  total: number;
  rows: number;
}

/**
 * The first statement that counts. A statement with no rows never wins over a
 * later one that counts; it gives a count of 0 only when no statement counts.
 * Null when every statement was refused or returned no number.
 */
export function countOf(outcomes: QueryOutcome[]): Count | null {
  let ranEmpty = false;
  for (const { rows } of outcomes) {
    if (!rows) continue;
    if (rows.length === 0) {
      ranEmpty = true;
      continue;
    }
    const total = totalOf(rows);
    if (total !== null) return { total, rows: rows.length };
  }
  return ranEmpty ? { total: 0, rows: 0 } : null;
}

const TIME_COLUMN = /bucket|day|date|time|hour|period|week/i;
const COUNT_COLUMN = /count|trace|total|volume|events/i;

/**
 * Sums the count column of a non-empty result. ClickHouse answers a UInt64 as
 * a string, so a numeric string counts as a number; a time bucket column never counts.
 */
function totalOf(rows: Record<string, unknown>[]): number | null {
  const numeric = (value: unknown): boolean =>
    typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
  const columns = Object.keys(rows[0] ?? {}).filter(
    (column) => !TIME_COLUMN.test(column) && rows.every((row) => numeric(row[column])),
  );
  const column = columns.find((name) => COUNT_COLUMN.test(name)) ?? columns[0];
  if (!column) return null;
  return rows.reduce((sum, row) => sum + Number(row[column]), 0);
}
