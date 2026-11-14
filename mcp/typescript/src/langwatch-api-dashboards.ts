import type {
  DashboardWidget,
  DashboardWidgetQueryInput,
} from "./langwatch-api-dashboard-widgets.js";
import { makeRequest } from "./langwatch-api.js";

/**
 * A dashboard in the Dashboards area, at `/api/v1/dashboards`; the project comes from the API key
 * (`modules/dashboard/contract/src/board-rest.schemas.ts`). Every route answers 404 while
 * Dashboards is off for the key's project. Analytics Reports live at `/api/v1/analytics/reports`.
 */
export interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

export interface DashboardListItem extends Dashboard {
  widgetCount: number;
}

const dashboardPath = (dashboardId: string) =>
  `/api/v1/dashboards/${encodeURIComponent(dashboardId)}`;
const widgetPath = (dashboardId: string, widgetId: string) =>
  `${dashboardPath(dashboardId)}/widgets/${encodeURIComponent(widgetId)}`;

/** The key's project's dashboards, each with how many widgets it holds. */
export async function listDashboards(): Promise<{ data: DashboardListItem[] }> {
  return makeRequest("GET", "/api/v1/dashboards") as Promise<{ data: DashboardListItem[] }>;
}

/** Reads one dashboard; a dashboard in another project, or an Analytics Report, answers 404. */
export async function getDashboard({ dashboardId }: { dashboardId: string }): Promise<Dashboard> {
  return makeRequest("GET", dashboardPath(dashboardId)) as Promise<Dashboard>;
}

export async function createDashboard({ name }: { name: string }): Promise<Dashboard> {
  return makeRequest("POST", "/api/v1/dashboards", { name }) as Promise<Dashboard>;
}

/** A field left out keeps its value; a `null` description clears it. */
export async function updateDashboard({
  dashboardId,
  ...changes
}: {
  dashboardId: string;
  name?: string;
  description?: string | null;
}): Promise<Dashboard> {
  return makeRequest("PATCH", dashboardPath(dashboardId), changes) as Promise<Dashboard>;
}

/** Deletes the dashboard with the widgets on it. */
export async function deleteDashboard({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<{ id: string; name: string }> {
  return makeRequest("DELETE", dashboardPath(dashboardId)) as Promise<{ id: string; name: string }>;
}

export async function listWidgetsOnDashboard({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<{ data: DashboardWidget[] }> {
  return makeRequest("GET", `${dashboardPath(dashboardId)}/widgets`) as Promise<{
    data: DashboardWidget[];
  }>;
}

/** Saves a widget placed on this dashboard at the next free row. */
export async function createWidgetOnDashboard({
  dashboardId,
  ...data
}: {
  dashboardId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueryInput[];
  description?: string;
}): Promise<DashboardWidget> {
  return makeRequest(
    "POST",
    `${dashboardPath(dashboardId)}/widgets`,
    data,
  ) as Promise<DashboardWidget>;
}

/** A widget on any other dashboard answers 404. */
export async function getWidgetOnDashboard({
  dashboardId,
  widgetId,
}: {
  dashboardId: string;
  widgetId: string;
}): Promise<DashboardWidget> {
  return makeRequest("GET", widgetPath(dashboardId, widgetId)) as Promise<DashboardWidget>;
}

export async function updateWidgetOnDashboard({
  dashboardId,
  widgetId,
  ...changes
}: {
  dashboardId: string;
  widgetId: string;
  name?: string;
  code?: string;
  queries?: DashboardWidgetQueryInput[];
  description?: string;
}): Promise<DashboardWidget> {
  return makeRequest(
    "PATCH",
    widgetPath(dashboardId, widgetId),
    changes,
  ) as Promise<DashboardWidget>;
}

export async function deleteWidgetOnDashboard({
  dashboardId,
  widgetId,
}: {
  dashboardId: string;
  widgetId: string;
}): Promise<void> {
  await makeRequest("DELETE", widgetPath(dashboardId, widgetId));
}
