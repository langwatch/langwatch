import { makeRequest } from "./langwatch-api.ts";

/** An Analytics Report, at `/api/v1/analytics/reports`. Dashboards live at `/api/v1/dashboards`. */
export interface AnalyticsReportSummary {
  id: string;
  name: string;
  order: number;
  graphCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsReportDetail extends AnalyticsReportSummary {
  graphs: unknown[];
}

export interface AnalyticsReportListResponse {
  data: AnalyticsReportSummary[];
}

const reportPath = (reportId: string) =>
  `/api/v1/analytics/reports/${encodeURIComponent(reportId)}`;

export async function listAnalyticsReports(): Promise<AnalyticsReportListResponse> {
  return makeRequest("GET", "/api/v1/analytics/reports") as Promise<AnalyticsReportListResponse>;
}

export async function getAnalyticsReport({
  reportId,
}: {
  reportId: string;
}): Promise<AnalyticsReportDetail> {
  return makeRequest("GET", reportPath(reportId)) as Promise<AnalyticsReportDetail>;
}

export async function createAnalyticsReport({
  name,
}: {
  name: string;
}): Promise<AnalyticsReportDetail> {
  return makeRequest("POST", "/api/v1/analytics/reports", {
    name,
  }) as Promise<AnalyticsReportDetail>;
}

export async function renameAnalyticsReport({
  reportId,
  name,
}: {
  reportId: string;
  name: string;
}): Promise<AnalyticsReportDetail> {
  return makeRequest("PATCH", reportPath(reportId), { name }) as Promise<AnalyticsReportDetail>;
}

export async function deleteAnalyticsReport({
  reportId,
}: {
  reportId: string;
}): Promise<{ id: string; name: string }> {
  return makeRequest("DELETE", reportPath(reportId)) as Promise<{ id: string; name: string }>;
}
