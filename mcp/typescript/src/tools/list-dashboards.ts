/**
 * The `list_dashboards` MCP tool: the dashboards a widget can be added to, with
 * the id `add_dashboard_widget` and `update_dashboard_widget` take.
 */

import { listDashboards } from "../langwatch-api-dashboards.js";

export async function handleListDashboards(): Promise<string> {
  const { data: dashboards } = await listDashboards();

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
