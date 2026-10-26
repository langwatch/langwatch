import { makeRequest } from "./langwatch-api.js";

/**
 * One named LangWatchQL statement a widget may run, as the REST endpoint validates it
 * (`modules/dashboard/contract/src/dashboard-widget-rest.schemas.ts`).
 */
export interface DashboardWidgetQueryInput {
  name: string;
  sql: string;
  parameters?: {
    name: string;
    type: "string" | "number" | "boolean";
    default?: string | number | boolean;
  }[];
}

/** Where a widget came from, as the platform records it. */
export type DashboardWidgetSource =
  | { kind: "catalogue"; catalogueId: string }
  | { kind: "langy" }
  | { kind: "code" }
  | { kind: "api" };

export interface DashboardWidgetDefinition {
  version: number;
  code: string;
  queries: DashboardWidgetQueryInput[];
  description?: string;
  prompt?: string;
  source?: DashboardWidgetSource;
}

export interface DashboardWidget {
  id: string;
  name: string;
  definition: DashboardWidgetDefinition;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

/** Reads one widget; a widget in another project answers 404. */
export async function getDashboardWidget(params: {
  projectId: string;
  widgetId: string;
}): Promise<DashboardWidget> {
  return makeRequest(
    "GET",
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/analytics/dashboard-widgets/${encodeURIComponent(params.widgetId)}`,
  ) as Promise<DashboardWidget>;
}

/** Changes the fields given; every field left out keeps its stored value. */
export async function updateDashboardWidget(params: {
  projectId: string;
  widgetId: string;
  name?: string;
  code?: string;
  queries?: DashboardWidgetQueryInput[];
  description?: string;
}): Promise<DashboardWidget> {
  const { projectId, widgetId, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/v1/projects/${encodeURIComponent(projectId)}/analytics/dashboard-widgets/${encodeURIComponent(widgetId)}`,
    data,
  ) as Promise<DashboardWidget>;
}
