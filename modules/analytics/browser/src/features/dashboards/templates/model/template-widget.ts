/**
 * What every template builds its widgets from: a stored definition from code and
 * named queries, and the full-width and half-width places on the chart grid.
 */

import { CHART_GRID_COLUMNS } from "../../../../model/chart-grid.ts";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
} from "../../../../model/dashboard-widget-definition.ts";
import type { BoardTemplateWidget } from "./board-template.ts";

export function definition({
  code,
  queries,
}: {
  code: string;
  queries: Readonly<Record<string, string>>;
}): DashboardWidgetDefinition {
  return {
    version: DASHBOARD_WIDGET_DEFINITION_VERSION,
    code,
    queries: Object.entries(queries).map(([name, text]) => ({ name, sql: text, parameters: [] })),
  };
}

const HALF = CHART_GRID_COLUMNS / 2;

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
