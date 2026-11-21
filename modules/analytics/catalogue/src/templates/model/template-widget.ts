/**
 * What every template builds its widgets from: a stored definition from code, its
 * description and named queries, plus the presence query its empty face runs when it has a
 * source to set up, and the full-width and half-width places on the chart grid.
 */

import type { TraceSource } from "@langwatch/analytics-contract";
import { CHART_GRID_COLUMNS } from "@langwatch/analytics-contract/chart-grid";
import {
  DASHBOARD_WIDGET_DEFINITION_VERSION,
  type DashboardWidgetDefinition,
} from "@langwatch/analytics-contract/dashboard-widget-definition";

import { PRESENCE_QUERY, readsSourcesParameter } from "../../model/sources-parameter.ts";
import type { BoardTemplateWidget } from "./board-template.ts";
import { PRESENCE_SQL } from "./source-presence-queries.ts";
import { readSources } from "./stock-query-sources.ts";
import type { WidgetCode } from "./widget-code-parts.ts";

/**
 * A stock widget's stored definition: each query that reads the sources parameter stores the list
 * the widget counts; one that never reads it stores none, since the list would say what is not so
 * (dashboards-v2 AC202, AC202b, AC202f).
 */
export function definition({
  code,
  queries,
  sources,
}: {
  code: WidgetCode;
  queries: Readonly<Record<string, string>>;
  sources: readonly TraceSource[];
}): DashboardWidgetDefinition {
  const all = code.source ? { ...queries, [PRESENCE_QUERY]: PRESENCE_SQL[code.source] } : queries;
  return {
    version: DASHBOARD_WIDGET_DEFINITION_VERSION,
    code: code.tsx,
    queries: Object.entries(all).map(([name, text]) => {
      const sql = name === PRESENCE_QUERY ? text : readSources(text);
      return {
        name,
        sql,
        parameters: [],
        ...(readsSourcesParameter(sql) ? { sources: [...sources] } : {}),
      };
    }),
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
