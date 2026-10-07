/**
 * The `add_dashboard_widget` MCP tool: create, then place, as the platform's own write path
 * does. The dashboard is checked first so a typo leaves no unplaced widget behind, and a
 * failed placement deletes the widget it just created.
 */

import {
  assignDashboardWidgetToDashboard,
  createDashboardWidget,
  deleteDashboardWidget,
} from "../langwatch-api-dashboard-widgets.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { assertDashboardExists } from "./dashboard-exists.js";
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

  const project = await getCurrentProject();
  await assertDashboardExists({ dashboardId: params.dashboardId });

  const widget = await createDashboardWidget({
    projectId: project.id,
    name: params.name,
    code: params.code,
    queries,
  });

  try {
    await assignDashboardWidgetToDashboard({
      projectId: project.id,
      widgetId: widget.id,
      dashboardId: params.dashboardId,
    });
  } catch (error) {
    // The widget now exists but is not on the dashboard we promised — never
    // leave it dangling because the dashboard vanished between the check
    // above and this call.
    await deleteDashboardWidget({
      projectId: project.id,
      widgetId: widget.id,
    }).catch(() => {
      // Best-effort cleanup; the assign error below is what the caller needs.
    });
    throw error;
  }

  return [
    `Widget "${params.name}" created and added to dashboard "${params.dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${queries.map((q) => q.name).join(", ")}`,
  ].join("\n");
}
