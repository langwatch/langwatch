import { deleteAnalyticsReport } from "../langwatch-api-analytics-reports.ts";

export async function handleDeleteAnalyticsReport(params: { reportId: string }): Promise<string> {
  const result = await deleteAnalyticsReport({ reportId: params.reportId });

  return `Analytics Report deleted successfully!\n\n**Name**: ${result.name}\n**ID**: ${result.id}`;
}
