import { getDashboard } from "../langwatch-api-boards.js";
import { getAnalyticsReport } from "../langwatch-api-dashboards.ts";
import { LangWatchApiError } from "../langwatch-api.js";

/** A Dashboards board has no Reports graphs; this renders what the board route answers. */
async function describeBoardOrThrow({ id, notFound }: { id: string; notFound: unknown }) {
  try {
    const board = await getDashboard({ dashboardId: id });
    return [
      `# ${board.name}\n`,
      `**ID**: ${board.id}`,
      `**Created**: ${board.createdAt}`,
      `**Updated**: ${board.updatedAt}`,
      `**URL**: ${board.platformUrl}`,
    ].join("\n");
  } catch (error) {
    // Only the board route's own 404 means neither area holds the id.
    if (error instanceof LangWatchApiError && error.status === 404) throw notFound;
    throw error;
  }
}

export async function handleGetDashboard(params: { id: string }): Promise<string> {
  let dashboard;
  try {
    dashboard = await getAnalyticsReport(params.id);
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
