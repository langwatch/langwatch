/**
 * The `update_dashboard_widget` MCP tool over the widget PATCH: a field left out keeps its
 * stored value. The widget must sit on the named dashboard, so an agent never edits one it
 * found somewhere else by mistake. Spec: modules/dashboard/specs/dashboard-widget-mcp.feature
 */

import {
  type DashboardWidget,
  getDashboardWidget,
  updateDashboardWidget,
} from "../langwatch-api-dashboard-widgets.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
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

  const project = await getCurrentProject();
  await assertDashboardExists({ dashboardId });
  const current = await getWidgetOnDashboard({ projectId: project.id, widgetId, dashboardId });

  const widget = await updateDashboardWidget({
    projectId: project.id,
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

/** The widget, refused by id when it is not in this project or not on this dashboard. */
async function getWidgetOnDashboard({
  projectId,
  widgetId,
  dashboardId,
}: {
  projectId: string;
  widgetId: string;
  dashboardId: string;
}): Promise<DashboardWidget> {
  let widget: DashboardWidget;
  try {
    widget = await getDashboardWidget({ projectId, widgetId });
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No widget with ID "${widgetId}" was found in this project. Use the widget ID add_dashboard_widget returned.`,
      );
    }
    throw error;
  }
  if (widget.dashboardId !== dashboardId) {
    throw new Error(
      `Widget "${widgetId}" is not on dashboard "${dashboardId}". Pass the dashboard the widget was added to.`,
    );
  }
  return widget;
}
