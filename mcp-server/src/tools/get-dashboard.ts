import { getDashboard as apiGetDashboard } from "../langwatch-api-dashboards.js";

export async function handleGetDashboard(params: { id: string }): Promise<string> {
  const dashboard = await apiGetDashboard(params.id);

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
