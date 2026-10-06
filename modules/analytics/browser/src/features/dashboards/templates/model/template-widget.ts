/**
 * What every template builds its widgets from: a stored definition from code, its
 * description and named queries, plus the presence query its empty face runs, and
 * the full-width and half-width places on the chart grid.
 */

import { CHART_GRID_COLUMNS } from "../../../../model/chart-grid.ts";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
} from "../../../../model/dashboard-widget-definition.ts";
import type { BoardTemplateWidget } from "./board-template.ts";
import { PRESENCE_SQL } from "./source-presence-queries.ts";
import type { WidgetCode } from "./widget-code-parts.ts";

export function definition({
  code,
  queries,
}: {
  code: WidgetCode;
  queries: Readonly<Record<string, string>>;
}): DashboardWidgetDefinition {
  const all = { ...queries, present: PRESENCE_SQL[code.source] };
  return {
    version: DASHBOARD_WIDGET_DEFINITION_VERSION,
    code: code.tsx,
    queries: Object.entries(all).map(([name, text]) => ({ name, sql: text, parameters: [] })),
    description: code.description,
  };
}

const HALF = CHART_GRID_COLUMNS / 2;

/** A table widget's default height: shorter than a chart's, since rows read fine compact. */
export const TABLE_ROWS = 4;

/** A widget across the whole grid, from `gridRow` down `rowSpan` board rows. */
export function full({
  gridRow,
  rowSpan,
}: {
  gridRow: number;
  rowSpan: number;
}): BoardTemplateWidget["layout"] {
  return { gridColumn: 0, gridRow, colSpan: CHART_GRID_COLUMNS, rowSpan };
}

/** A widget in a pair: left or right half of the rows that start at `gridRow`. */
export function half({
  side,
  gridRow,
  rowSpan = 5,
}: {
  side: "left" | "right";
  gridRow: number;
  rowSpan?: number;
}): BoardTemplateWidget["layout"] {
  return { gridColumn: side === "left" ? 0 : HALF, gridRow, colSpan: HALF, rowSpan };
}
