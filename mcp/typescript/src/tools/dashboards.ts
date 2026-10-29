/**
 * The dashboard tools over `/api/v1/dashboards`: read, create, rename and delete a dashboard,
 * list a dashboard's widgets and delete one. Spec: modules/dashboard/specs/dashboards-v2.feature
 * AC199s.
 */

import {
  type Dashboard,
  createDashboard,
  deleteDashboard,
  deleteWidgetOnDashboard,
  getDashboard,
  listWidgetsOnDashboard,
  updateDashboard,
} from "../langwatch-api-dashboards.js";

function describeLangyTraces(excludedOrigins: string[] | null | undefined): string {
  if (excludedOrigins == null) return "default (left out, included in a personal project)";
  if (excludedOrigins.length === 0) return "included";
  const others = excludedOrigins.filter((origin) => origin !== "langy");
  const langy = excludedOrigins.includes("langy") ? "left out" : "included";
  return others.length === 0 ? langy : `${langy}; also leaves out ${others.join(", ")}`;
}

function describeDashboard(dashboard: Dashboard): string[] {
  return [
    `**Name**: ${dashboard.name}`,
    `**ID**: ${dashboard.id}`,
    `**Scope**: ${dashboard.scope}`,
    ...(dashboard.description ? [`**Description**: ${dashboard.description}`] : []),
    `**Langy traces**: ${describeLangyTraces(dashboard.excludedOrigins)}`,
    `**URL**: ${dashboard.platformUrl}`,
  ];
}

/** Reads only `/api/v1/dashboards`; an Analytics Report's id is not found there. */
export async function handleGetDashboard({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<string> {
  const dashboard = await getDashboard({ dashboardId });
  return [`# ${dashboard.name}\n`, ...describeDashboard(dashboard)].join("\n");
}

export async function handleCreateDashboard({ name }: { name: string }): Promise<string> {
  const dashboard = await createDashboard({ name });
  return [
    "Dashboard created.\n",
    ...describeDashboard(dashboard),
    "",
    "> Pass the ID to `add_dashboard_widget` to add a widget to it.",
  ].join("\n");
}

export async function handleRenameDashboard({
  dashboardId,
  name,
  description,
  excludedOrigins,
}: {
  dashboardId: string;
  name?: string;
  description?: string;
  excludedOrigins?: string[] | null;
}): Promise<string> {
  if (name === undefined && description === undefined && excludedOrigins === undefined) {
    throw new Error("Provide at least one of name, description or excludedOrigins to change.");
  }
  const dashboard = await updateDashboard({
    dashboardId,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(excludedOrigins === undefined ? {} : { excludedOrigins }),
  });
  return ["Dashboard updated.\n", ...describeDashboard(dashboard)].join("\n");
}

export async function handleDeleteDashboard({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<string> {
  const deleted = await deleteDashboard({ dashboardId });
  return `Dashboard "${deleted.name}" deleted with its widgets (ID: ${deleted.id}).`;
}

export async function handleListDashboardWidgets({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<string> {
  const { data: widgets } = await listWidgetsOnDashboard({ dashboardId });
  if (widgets.length === 0) return `Dashboard "${dashboardId}" has no widgets.`;

  return [
    `# Widgets on dashboard ${dashboardId} (${widgets.length} total)\n`,
    ...widgets.flatMap((widget) => [
      `## ${widget.name}`,
      `**ID**: ${widget.id}`,
      `**Queries**: ${widget.definition.queries.map((query) => query.name).join(", ") || "(none)"}`,
      "",
    ]),
  ].join("\n");
}

export async function handleDeleteDashboardWidget({
  dashboardId,
  widgetId,
}: {
  dashboardId: string;
  widgetId: string;
}): Promise<string> {
  await deleteWidgetOnDashboard({ dashboardId, widgetId });
  return `Widget "${widgetId}" deleted from dashboard "${dashboardId}".`;
}
