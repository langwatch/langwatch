/**
 * `update_dashboard_widget`: the widget must sit on the named dashboard, so an agent never edits
 * one it found elsewhere by mistake.
 * Spec: modules/dashboard/specs/dashboard-widget-mcp.feature
 */

import type { DashboardWidget, WidgetSource } from "../langwatch-api-dashboard-widgets.js";
import { getWidgetOnDashboard, updateWidgetOnDashboard } from "../langwatch-api-dashboards.js";
import { LangWatchApiError } from "../langwatch-api.js";
import {
  type DashboardWidgetQueriesInput,
  normalizeDashboardWidgetQueries,
  withSources,
} from "./dashboard-widget-queries.js";

export interface UpdateDashboardWidgetParams {
  dashboardId: string;
  widgetId: string;
  name?: string;
  code?: string;
  queries?: DashboardWidgetQueriesInput;
  description?: string;
  /** Set on every query; alone, it is sent with the widget's stored queries. */
  sources?: WidgetSource[] | null;
}

export async function handleUpdateDashboardWidget(
  params: UpdateDashboardWidgetParams,
): Promise<string> {
  const { dashboardId, widgetId, name, code, description, sources } = params;
  const fields = [name, code, params.queries, description, sources];
  if (fields.every((field) => field === undefined)) {
    throw new Error(
      "Provide at least one of name, code, queries, description or sources to change.",
    );
  }

  const current = await widgetOnDashboardOrRefused({ widgetId, dashboardId });
  const given =
    params.queries === undefined
      ? undefined
      : normalizeDashboardWidgetQueries({ queries: params.queries });
  // Sources alone: the stored queries go back with the new list on each.
  const base = given ?? (sources === undefined ? undefined : current.definition.queries);
  const queries = base === undefined ? undefined : withSources({ queries: base, sources });

  const changes = {
    ...(name === undefined ? {} : { name }),
    ...(code === undefined ? {} : { code }),
    ...(queries === undefined ? {} : { queries }),
    ...(description === undefined ? {} : { description }),
  };

  const widget = await updateWidgetOnDashboard({ dashboardId, widgetId: current.id, ...changes });

  return [
    `Widget "${widget.name}" updated on dashboard "${dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${widget.definition.queries.map((query) => query.name).join(", ") || "(none)"}`,
    "",
    "```json",
    JSON.stringify(widget, null, 2),
    "```",
  ].join("\n");
}

/** The widget, refused by id when it is not on this dashboard (the dashboard route answers 404). */
async function widgetOnDashboardOrRefused({
  widgetId,
  dashboardId,
}: {
  widgetId: string;
  dashboardId: string;
}): Promise<DashboardWidget> {
  try {
    return await getWidgetOnDashboard({ dashboardId, widgetId });
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No widget with ID "${widgetId}" was found on dashboard "${dashboardId}". Use the widget ID add_dashboard_widget returned, and the dashboard it was added to.`,
      );
    }
    throw error;
  }
}
