/**
 * Handles the `add_dashboard_widget` MCP tool invocation.
 *
 * Creates a dashboard widget (TSX code + named LangWatchQL queries) and
 * places it on the given dashboard. Two REST calls under one tool because the
 * platform's own write path is create-then-place: `POST
 * /analytics/dashboard-widgets` saves an unplaced widget, and `POST
 * .../dashboard` puts it on a board.
 *
 * The dashboard is checked to exist BEFORE creating anything — a typo'd
 * `dashboardId` must never leave an orphaned, unplaced widget behind. If the
 * placement call itself still fails (e.g. the dashboard was deleted between
 * the check and the create), the widget just created is deleted so nothing
 * is left dangling.
 *
 * @see specs/mcp-server (dashboard widget tools)
 */

import { getDashboard } from "../langwatch-api-dashboards.js";
import {
  assignDashboardWidgetToDashboard,
  createDashboardWidget,
  deleteDashboardWidget,
  type DashboardWidgetQueryInput,
} from "../langwatch-api-dashboard-widgets.js";
import { LangWatchApiError } from "../langwatch-api.js";
import { getCurrentProject } from "../langwatch-api-projects.js";

/** A widget file rarely needs more than a couple of named queries (server bound). */
export const MAX_DASHBOARD_WIDGET_QUERIES = 8;

export type AddDashboardWidgetQueriesInput =
  | DashboardWidgetQueryInput[]
  | Record<string, string>;

export interface AddDashboardWidgetParams {
  dashboardId: string;
  name: string;
  code: string;
  queries: AddDashboardWidgetQueriesInput;
}

/** Turns the `{ name: sql }` shorthand into the array shape the REST endpoint validates. */
function normalizeQueries(
  queries: AddDashboardWidgetQueriesInput,
): DashboardWidgetQueryInput[] {
  if (Array.isArray(queries)) return queries;
  return Object.entries(queries).map(([name, sql]) => ({ name, sql }));
}

export async function handleAddDashboardWidget(
  params: AddDashboardWidgetParams,
): Promise<string> {
  const queries = normalizeQueries(params.queries);
  if (queries.length === 0) {
    throw new Error(
      "Provide at least one named LWQL query in `queries`. Validate each query's SQL first with run_query.",
    );
  }
  if (queries.length > MAX_DASHBOARD_WIDGET_QUERIES) {
    throw new Error(
      `A widget may declare at most ${MAX_DASHBOARD_WIDGET_QUERIES} queries, got ${queries.length}.`,
    );
  }

  const project = await getCurrentProject();

  try {
    await getDashboard(params.dashboardId);
  } catch (error) {
    const status = error instanceof LangWatchApiError ? error.status : undefined;
    if (status === 404) {
      throw new Error(
        `No dashboard with ID "${params.dashboardId}" was found in this project. Use platform_list_dashboards to find a valid dashboard ID.`,
      );
    }
    throw error;
  }

  const widget = await createDashboardWidget({
    projectId: project.id,
    name: params.name,
    code: params.code,
    queries,
  });

  try {
    await assignDashboardWidgetToDashboard({
      projectId: project.id,
      widgetId: widget.id,
      dashboardId: params.dashboardId,
    });
  } catch (error) {
    // The widget now exists but is not on the dashboard we promised — never
    // leave it dangling because the dashboard vanished between the check
    // above and this call.
    await deleteDashboardWidget({
      projectId: project.id,
      widgetId: widget.id,
    }).catch(() => {
      // Best-effort cleanup; the assign error below is what the caller needs.
    });
    throw error;
  }

  return [
    `Widget "${params.name}" created and added to dashboard "${params.dashboardId}".`,
    `**Widget ID**: ${widget.id}`,
    `**Queries**: ${queries.map((q) => q.name).join(", ")}`,
  ].join("\n");
}
