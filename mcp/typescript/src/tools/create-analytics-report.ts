import { createAnalyticsReport } from "../langwatch-api-analytics-reports.ts";

export async function handleCreateAnalyticsReport(params: { name: string }): Promise<string> {
  const report = await createAnalyticsReport({ name: params.name });

  return `Analytics Report created successfully!\n\n**Name**: ${report.name}\n**ID**: ${report.id}`;
}
