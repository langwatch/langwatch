/**
 * The `list_dashboard_boards` MCP tool: the Dashboards boards a widget can be added to, with
 * the id `add_dashboard_widget` and `update_dashboard_widget` take.
 */

import { listBoards } from "../langwatch-api-boards.js";
import { getCurrentProject } from "../langwatch-api-projects.js";

export async function handleListDashboardBoards(): Promise<string> {
  const project = await getCurrentProject();
  const { data: boards } = await listBoards({ projectId: project.id });

  if (boards.length === 0) {
    return "No dashboards found in this project. Create one in the Dashboards area first.";
  }

  return [
    `# Dashboards (${boards.length} total)\n`,
    ...boards.flatMap((board) => [
      `## ${board.name}`,
      `**ID**: ${board.id}`,
      `**Widgets**: ${board.widgetCount}`,
      `**URL**: ${board.platformUrl}`,
      "",
    ]),
    "> Pass the ID to `add_dashboard_widget` to add a widget to that dashboard.",
  ].join("\n");
}
