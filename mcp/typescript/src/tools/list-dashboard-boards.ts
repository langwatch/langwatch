/**
 * The `list_dashboard_boards` MCP tool: the Dashboards boards a widget can be added to, with
 * the id `add_dashboard_widget` and `update_dashboard_widget` take.
 */

import { listBoards, listProjectBoards } from "../langwatch-api-boards.js";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";

/**
 * /api/v1/boards first, so no deprecation note; it answers 404 while Dashboards is off (or on a
 * server without it), and only then the project-path list, which answers either way.
 */
async function boardsOfProject() {
  try {
    return await listBoards();
  } catch (error) {
    if (!(error instanceof LangWatchApiError && error.status === 404)) throw error;
    const project = await getCurrentProject();
    return listProjectBoards({ projectId: project.id });
  }
}

export async function handleListDashboardBoards(): Promise<string> {
  const { data: boards } = await boardsOfProject();

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
