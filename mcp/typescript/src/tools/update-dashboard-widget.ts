/**
 * `update_dashboard_widget`: the widget must sit on the named dashboard, so an agent never edits
 * one it found elsewhere by mistake. On a 404 (Dashboards off) it uses the project-path routes.
 * Spec: modules/dashboard/specs/dashboard-widget-mcp.feature
 */

import {
  type DashboardWidget,
  getDashboardWidget,
  updateDashboardWidget,
} from "../langwatch-api-dashboard-widgets.js";
import { getWidgetOnDashboard, updateWidgetOnDashboard } from "../langwatch-api-dashboards.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { assertProjectDashboardExists, isOnDashboardRoutes } from "./dashboard-exists.js";
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

  const changes = {
    ...(name === undefined ? {} : { name }),
    ...(code === undefined ? {} : { code }),
    ...(queries === undefined ? {} : { queries }),
    ...(description === undefined ? {} : { description }),
  };

  let widget: DashboardWidget;
  if (await isOnDashboardRoutes({ dashboardId })) {
    const current = await widgetOnDashboardOrRefused({ widgetId, dashboardId });
    widget = await updateWidgetOnDashboard({ dashboardId, widgetId: current.id, ...changes });
  } else {
    const project = await getCurrentProject();
    await assertProjectDashboardExists({ projectId: project.id, dashboardId });
    const current = await getWidgetOnProjectPath({ projectId: project.id, widgetId, dashboardId });
    widget = await updateDashboardWidget({
      projectId: project.id,
      widgetId: current.id,
      ...changes,
    });
  }

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

/** The project-path widget, refused by id unless it is in this project and on this dashboard. */
async function getWidgetOnProjectPath({
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
