import { makeRequest } from "./langwatch-api.ts";

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

export async function listAnalyticsReports(): Promise<DashboardListResponse> {
  return makeRequest("GET", "/api/v1/analytics/reports") as Promise<DashboardListResponse>;
}

export async function getAnalyticsReport(id: string): Promise<DashboardDetail> {
  return makeRequest(
    "GET",
    `/api/v1/analytics/reports/${encodeURIComponent(id)}`,
  ) as Promise<DashboardDetail>;
}

export async function createAnalyticsReport(data: { name: string }): Promise<DashboardDetail> {
  return makeRequest("POST", "/api/v1/analytics/reports", data) as Promise<DashboardDetail>;
}

export async function renameAnalyticsReport(
  id: string,
  data: { name: string },
): Promise<DashboardDetail> {
  return makeRequest(
    "PATCH",
    `/api/v1/analytics/reports/${encodeURIComponent(id)}`,
    data,
  ) as Promise<DashboardDetail>;
}

export async function deleteAnalyticsReport(id: string): Promise<{ id: string; name: string }> {
  return makeRequest("DELETE", `/api/v1/analytics/reports/${encodeURIComponent(id)}`) as Promise<{
    id: string;
    name: string;
  }>;
}
