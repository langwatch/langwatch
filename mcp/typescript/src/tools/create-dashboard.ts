import { createDashboard as apiCreateDashboard } from "../langwatch-api-dashboards.js";

export async function handleCreateDashboard(params: { name: string }): Promise<string> {
  const dashboard = await apiCreateDashboard({ name: params.name });

  return `Dashboard created successfully!\n\n**Name**: ${dashboard.name}\n**ID**: ${dashboard.id}`;
}
