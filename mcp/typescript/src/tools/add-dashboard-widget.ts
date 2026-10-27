/**
 * `add_dashboard_widget`: one create under the board's path, which places the widget as it saves
 * it. On a 404 (Dashboards off) it creates, then places, on the project path; a failed placement
 * deletes the widget it just created.
 */

import { createWidgetOnDashboard } from "../langwatch-api-boards.js";
import {
  assignDashboardWidgetToDashboard,
  createDashboardWidget,
  deleteDashboardWidget,
  type DashboardWidget,
  type DashboardWidgetQueryInput,
} from "../langwatch-api-dashboard-widgets.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { assertProjectDashboardExists, isOnBoardRoutes } from "./dashboard-exists.js";
import {
  type DashboardWidgetQueriesInput,
  normalizeDashboardWidgetQueries,
} from "./dashboard-widget-queries.js";

export interface AddDashboardWidgetParams {
  dashboardId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueriesInput;
}

export async function handleAddDashboardWidget(params: AddDashboardWidgetParams): Promise<string> {
  const queries = normalizeDashboardWidgetQueries({ queries: params.queries });

  const widget = (await isOnBoardRoutes({ dashboardId: params.dashboardId }))
    ? await createWidgetOnDashboard({
        dashboardId: params.dashboardId,
        name: params.name,
        code: params.code,
        queries,
      })
    : await createOnProjectPath({ ...params, queries });

  return [
    `Widget "${params.name}" created and added to dashboard "${params.dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${queries.map((q) => q.name).join(", ")}`,
  ].join("\n");
}

async function createOnProjectPath({
  dashboardId,
  name,
  code,
  queries,
}: {
  dashboardId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueryInput[];
}): Promise<DashboardWidget> {
  const project = await getCurrentProject();
  await assertProjectDashboardExists({ projectId: project.id, dashboardId });

  const widget = await createDashboardWidget({ projectId: project.id, name, code, queries });
  try {
    return await assignDashboardWidgetToDashboard({
      projectId: project.id,
      widgetId: widget.id,
      dashboardId,
    });
  } catch (error) {
    // Never leave an unplaced widget behind if the dashboard vanished since the check above.
    await deleteDashboardWidget({ projectId: project.id, widgetId: widget.id }).catch(() => {});
    throw error;
  }
}
