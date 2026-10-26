/**
 * The `update_dashboard_widget` MCP tool over the widget PATCH: a field left out keeps its
 * stored value. The widget must sit on the named dashboard, so an agent never edits one it
 * found somewhere else by mistake. Spec: modules/dashboard/specs/dashboard-widget-mcp.feature
 */

import { getBoardWidget, updateBoardWidget } from "../langwatch-api-boards.js";
import type { DashboardWidget } from "../langwatch-api-dashboard-widgets.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { assertDashboardExists } from "./dashboard-exists.js";
import {
  type DashboardWidgetQueriesInput,
  normalizeDashboardWidgetQueries,
} from "./dashboard-widget-queries.js";

export interface UpdateDashboardWidgetParams {
  dashboardId: string;
  widgetId: string;
  name?: string;
  code?: string;
  queries?: DashboardWidgetQueriesInput;
  description?: string;
}

export async function handleUpdateDashboardWidget(
  params: UpdateDashboardWidgetParams,
): Promise<string> {
  const { dashboardId, widgetId, name, code, description } = params;
  if (
    name === undefined &&
    code === undefined &&
    params.queries === undefined &&
    description === undefined
  ) {
    throw new Error("Provide at least one of name, code, queries or description to change.");
  }
  const queries =
    params.queries === undefined
      ? undefined
      : normalizeDashboardWidgetQueries({ queries: params.queries });

  await assertDashboardExists({ dashboardId });
  const current = await getWidgetOnDashboard({ widgetId, dashboardId });

  const widget = await updateBoardWidget({
    boardId: dashboardId,
    widgetId: current.id,
    ...(name === undefined ? {} : { name }),
    ...(code === undefined ? {} : { code }),
    ...(queries === undefined ? {} : { queries }),
    ...(description === undefined ? {} : { description }),
  });

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

/** The widget, refused by id when it is not on this dashboard (the board route answers 404). */
async function getWidgetOnDashboard({
  widgetId,
  dashboardId,
}: {
  widgetId: string;
  dashboardId: string;
}): Promise<DashboardWidget> {
  try {
    return await getBoardWidget({ boardId: dashboardId, widgetId });
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No widget with ID "${widgetId}" was found on dashboard "${dashboardId}". Use the widget ID add_dashboard_widget returned, and the dashboard it was added to.`,
      );
    }
    throw error;
  }
}
