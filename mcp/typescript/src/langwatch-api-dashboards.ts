import { makeRequest } from "./langwatch-api.js";

export interface DashboardSummary {
  id: string;
  name: string;
  order: number;
  graphCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardDetail extends DashboardSummary {
  graphs: unknown[];
}

export interface DashboardListResponse {
  data: DashboardSummary[];
}

export async function listDashboards(): Promise<DashboardListResponse> {
  return makeRequest("GET", "/api/v1/dashboards") as Promise<DashboardListResponse>;
}

export async function getDashboard(id: string): Promise<DashboardDetail> {
  return makeRequest(
    "GET",
    `/api/v1/dashboards/${encodeURIComponent(id)}`,
  ) as Promise<DashboardDetail>;
}

export async function createDashboard(data: { name: string }): Promise<DashboardDetail> {
  return makeRequest("POST", "/api/v1/dashboards", data) as Promise<DashboardDetail>;
}

export async function renameDashboard(
  id: string,
  data: { name: string },
): Promise<DashboardDetail> {
  return makeRequest(
    "PATCH",
    `/api/v1/dashboards/${encodeURIComponent(id)}`,
    data,
  ) as Promise<DashboardDetail>;
}

export async function deleteDashboard(id: string): Promise<{ id: string; name: string }> {
  return makeRequest("DELETE", `/api/v1/dashboards/${encodeURIComponent(id)}`) as Promise<{
    id: string;
    name: string;
  }>;
}
