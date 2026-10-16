import { getBoard } from "../langwatch-api-boards.js";
import { getDashboard as apiGetDashboard } from "../langwatch-api-dashboards.ts";
import { getCurrentProject } from "../langwatch-api-projects.js";
import { LangWatchApiError } from "../langwatch-api.js";

/** A Dashboards board has no Reports graphs; this renders what the board route answers. */
async function describeBoardOrThrow({ id, notFound }: { id: string; notFound: unknown }) {
  const project = await getCurrentProject();
  try {
    const board = await getBoard({ projectId: project.id, boardId: id });
    return [
      `# ${board.name}\n`,
      `**ID**: ${board.id}`,
      `**Created**: ${board.createdAt}`,
      `**Updated**: ${board.updatedAt}`,
      `**URL**: ${board.platformUrl}`,
    ].join("\n");
  } catch {
    throw notFound;
  }
}

export async function handleGetDashboard(params: { id: string }): Promise<string> {
  let dashboard;
  try {
    dashboard = await apiGetDashboard(params.id);
  } catch (error) {
    // The Reports API never holds a Dashboards board, so its 404 is not final.
    if (error instanceof LangWatchApiError && error.status === 404) {
      return describeBoardOrThrow({ id: params.id, notFound: error });
    }
    throw error;
  }

  const lines: string[] = [];
  lines.push(`# ${dashboard.name}\n`);
  lines.push(`**ID**: ${dashboard.id}`);
  lines.push(`**Order**: ${dashboard.order}`);
  lines.push(`**Graphs**: ${Array.isArray(dashboard.graphs) ? dashboard.graphs.length : 0}`);
  lines.push(`**Created**: ${dashboard.createdAt}`);
  lines.push(`**Updated**: ${dashboard.updatedAt}`);

  if (Array.isArray(dashboard.graphs) && dashboard.graphs.length > 0) {
    lines.push("\n## Graphs\n");
    lines.push("```json");
    lines.push(JSON.stringify(dashboard.graphs, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}
