import { deleteDashboard as apiDeleteDashboard } from "../langwatch-api-dashboards.js";

export async function handleDeleteDashboard(params: { id: string }): Promise<string> {
  const result = await apiDeleteDashboard(params.id);

  return `Dashboard deleted successfully!\n\n**Name**: ${result.name}\n**ID**: ${result.id}`;
}
