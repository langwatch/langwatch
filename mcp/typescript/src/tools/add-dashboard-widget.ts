/**
 * `add_dashboard_widget`: one create under the dashboard's path, which also places the widget.
 */

import { createWidgetOnDashboard } from "../langwatch-api-dashboards.js";
import { LangWatchApiError } from "../langwatch-api.js";
import {
  type DashboardWidgetQueriesInput,
  normalizeDashboardWidgetQueries,
} from "./dashboard-widget-queries.js";

export interface AddDashboardWidgetParams {
  dashboardId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueriesInput;
}

export async function handleAddDashboardWidget(params: AddDashboardWidgetParams): Promise<string> {
  const queries = normalizeDashboardWidgetQueries({ queries: params.queries });

  let widget;
  try {
    widget = await createWidgetOnDashboard({
      dashboardId: params.dashboardId,
      name: params.name,
      code: params.code,
      queries,
    });
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No dashboard with ID "${params.dashboardId}" was found in this project. Use list_dashboards to find a valid dashboard ID.`,
      );
    }
    throw error;
  }

  return [
    `Widget "${params.name}" created and added to dashboard "${params.dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${queries.map((q) => q.name).join(", ")}`,
  ].join("\n");
}
