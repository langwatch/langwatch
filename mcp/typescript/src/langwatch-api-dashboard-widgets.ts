import { makeRequest } from "./langwatch-api.js";

/**
 * A dashboard widget's client-supplied definition: TSX source plus the named
 * LangWatchQL statements it may run. Matches the shape
 * `dashboardWidgetQuerySchema` validates server-side
 * (`platform/app/src/server/analytics/dashboardWidgetDefinition.ts`).
 */
export interface DashboardWidgetQueryInput {
  name: string;
  sql: string;
  parameters?: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    default?: string | number | boolean;
  }>;
}

export interface DashboardWidgetDefinition {
  version: number;
  code: string;
  queries: DashboardWidgetQueryInput[];
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

/** Saves a new widget, unplaced (not yet on any dashboard). */
export async function createDashboardWidget(params: {
  projectId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueryInput[];
}): Promise<DashboardWidget> {
  const { projectId, ...data } = params;
  return makeRequest(
    "POST",
    `/api/v1/projects/${encodeURIComponent(projectId)}/analytics/dashboard-widgets`,
    data,
  ) as Promise<DashboardWidget>;
}

/** Places an existing widget on a dashboard, at the next free row. */
export async function assignDashboardWidgetToDashboard(params: {
  projectId: string;
  widgetId: string;
  dashboardId: string;
}): Promise<DashboardWidget> {
  return makeRequest(
    "POST",
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/analytics/dashboard-widgets/${encodeURIComponent(params.widgetId)}/dashboard`,
    { dashboardId: params.dashboardId },
  ) as Promise<DashboardWidget>;
}

/** Deletes a widget. Used to undo a create when placing it fails. */
export async function deleteDashboardWidget(params: {
  projectId: string;
  widgetId: string;
}): Promise<void> {
  await makeRequest(
    "DELETE",
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/analytics/dashboard-widgets/${encodeURIComponent(params.widgetId)}`,
  );
}
