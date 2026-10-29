import { getAnalyticsReport } from "../langwatch-api-analytics-reports.ts";

/** Reads only `/api/v1/analytics/reports`; a Dashboards dashboard's id is not found there. */
export async function handleGetAnalyticsReport(params: { reportId: string }): Promise<string> {
  const report = await getAnalyticsReport({ reportId: params.reportId });

  const lines: string[] = [];
  lines.push(`# ${report.name}\n`);
  lines.push(`**ID**: ${report.id}`);
  lines.push(`**Order**: ${report.order}`);
  lines.push(`**Graphs**: ${Array.isArray(report.graphs) ? report.graphs.length : 0}`);
  lines.push(`**Created**: ${report.createdAt}`);
  lines.push(`**Updated**: ${report.updatedAt}`);

  if (Array.isArray(report.graphs) && report.graphs.length > 0) {
    lines.push("\n## Graphs\n");
    lines.push("```json");
    lines.push(JSON.stringify(report.graphs, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}
