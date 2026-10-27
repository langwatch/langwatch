/**
 * The `list_dashboards` MCP tool: the dashboards a widget can be added to, with
 * the id `add_dashboard_widget` and `update_dashboard_widget` take.
 */

import { listDashboards, listProjectDashboards } from "../langwatch-api-dashboards.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";

/**
 * /api/v1/dashboards first; it answers 404 while Dashboards is off (or on a
 * server without it), and only then the project-path list, which answers either way.
 */
async function dashboardsOfProject() {
  try {
    return await listDashboards();
  } catch (error) {
    if (!(error instanceof LangWatchApiError && error.status === 404)) throw error;
    const project = await getCurrentProject();
    return listProjectDashboards({ projectId: project.id });
  }
}

export async function handleListDashboards(): Promise<string> {
  const { data: dashboards } = await dashboardsOfProject();

  if (dashboards.length === 0) {
    return "No dashboards found in this project. Create one in the Dashboards area first.";
  }

  return [
    `# Dashboards (${dashboards.length} total)\n`,
    ...dashboards.flatMap((dashboard) => [
      `## ${dashboard.name}`,
      `**ID**: ${dashboard.id}`,
      `**Widgets**: ${dashboard.widgetCount}`,
      `**URL**: ${dashboard.platformUrl}`,
      "",
    ]),
    "> Pass the ID to `add_dashboard_widget` to add a widget to that dashboard.",
  ].join("\n");
}
