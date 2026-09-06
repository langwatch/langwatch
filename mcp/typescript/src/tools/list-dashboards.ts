import { listDashboards as apiListDashboards } from "../langwatch-api-dashboards.js";

export async function handleListDashboards(): Promise<string> {
  const result = await apiListDashboards();
  const dashboards = result.data;

  if (!Array.isArray(dashboards) || dashboards.length === 0) {
    return "No dashboards found in this project.\n\n> Tip: Use `platform_create_dashboard` to create a new dashboard.";
  }

  const lines: string[] = [];
  lines.push(`# Dashboards (${dashboards.length} total)\n`);

  for (const d of dashboards) {
    lines.push(`## ${d.name}`);
    lines.push(`**ID**: ${d.id}`);
    lines.push(`**Graphs**: ${d.graphCount}`);
    lines.push(`**Updated**: ${d.updatedAt}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_dashboard` with the ID to see dashboard details including graphs.",
  );

  return lines.join("\n");
}
