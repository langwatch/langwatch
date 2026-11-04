import { listAnalyticsReports } from "../langwatch-api-analytics-reports.ts";

export async function handleListAnalyticsReports(): Promise<string> {
  const result = await listAnalyticsReports();
  const reports = result.data;

  if (!Array.isArray(reports) || reports.length === 0) {
    return "No Analytics Reports found in this project.\n\n> Tip: Use `platform_create_analytics_report` to create a new Analytics Report.";
  }

  const lines: string[] = [];
  lines.push(`# Analytics Reports (${reports.length} total)\n`);

  for (const report of reports) {
    lines.push(`## ${report.name}`);
    lines.push(`**ID**: ${report.id}`);
    lines.push(`**Graphs**: ${report.graphCount}`);
    lines.push(`**Updated**: ${report.updatedAt}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_analytics_report` with the ID to see the Analytics Report's details including graphs.",
  );

  return lines.join("\n");
}
