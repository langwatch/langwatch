/**
 * The `add_dashboard_widget` MCP tool: one create under the board's own path,
 * `POST /api/v1/boards/{boardId}/widgets`, which places the widget as it saves it. The board
 * is checked first so a typo names the id the agent passed.
 */

import { createBoardWidget } from "../langwatch-api-boards.js";
import { assertDashboardExists } from "./dashboard-exists.js";
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

  await assertDashboardExists({ dashboardId: params.dashboardId });

  const widget = await createBoardWidget({
    boardId: params.dashboardId,
    name: params.name,
    code: params.code,
    queries,
  });

  return [
    `Widget "${params.name}" created and added to dashboard "${params.dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${queries.map((q) => q.name).join(", ")}`,
  ].join("\n");
}
