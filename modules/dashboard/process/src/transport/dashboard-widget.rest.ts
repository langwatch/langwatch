import type { DashboardWidget } from "@langwatch/analytics-contract";
/**
 * Dashboard widgets under `/api/v1/projects/:projectId/analytics/dashboard-widgets`,
 * the `CustomGraph`-playground twin of saved-workbench-chart. This feature owns the
 * wire shapes and the rows; this file only declares the routes.
 */
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
  type RouteResponse,
} from "@langwatch/api/rest";
import {
  assignDashboardWidgetToDashboardSchema,
  createDashboardWidgetSchema,
  DashboardApi,
  dashboardWidgetListSchema,
  dashboardWidgetParamsSchema,
  dashboardWidgetProjectParamsSchema,
  dashboardWidgetResourceSchema,
  updateDashboardWidgetSchema,
} from "@langwatch/dashboard-contract";
import { z } from "zod";

/**
 * The deep link back into the dashboards page for the project this credential
 * resolved. A fact, because the deployment's own origin is the process's
 * answer and not a module's — the same reasoning as `savedWorkbenchChartUrl`.
 */
export const dashboardWidgetUrl = defineRestMiddleware("dashboardWidgetUrl", z.string());

/** The tags every operation in this file carries in the published document. */
const WIDGET_TAGS = ["Analytics / LangWatchQL"];

/**
 * The not-found answer every resource operation can give — a missing id and
 * another project's widget alike, deliberately indistinguishable.
 */
const widgetNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No dashboard widget with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/** The widget as the API publishes it. */
function widgetResource(
  widget: DashboardWidget,
  platformUrl: string,
): z.infer<typeof dashboardWidgetResourceSchema> {
  return {
    id: widget.id,
    name: widget.name,
    definition: { ...widget.definition, queries: [...widget.definition.queries] },
    createdAt: widget.createdAt.toString(),
    updatedAt: widget.updatedAt.toString(),
    platformUrl,
    dashboardId: widget.dashboardId,
    gridColumn: widget.gridColumn,
    gridRow: widget.gridRow,
    colSpan: widget.colSpan,
    rowSpan: widget.rowSpan,
  };
}

/**
 * The type is written out rather than inferred so the declaration emit
 * stays portable.
 */
export const dashboardWidgetRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<DashboardApi>;
}> = defineRestRouter(DashboardApi)
  .withNamespace("dashboard-widgets")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets",
    "getApiV1ProjectsByProjectIdAnalyticsDashboardWidgets",
  )
  .withParams(dashboardWidgetProjectParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(dashboardWidgetUrl)
  .withOutput(dashboardWidgetListSchema)
  .withDocs({
    summary: "List dashboard widgets",
    description:
      "Lists every dashboard widget in this project, each with the React source file it renders and the named LangWatchQL queries it may run. Saved workbench charts and builder charts are different kinds and are not listed here.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: { description: "The project's dashboard widgets" },
    },
  })
  .handle(async ({ app, scope }, platformUrl) => {
    const projectId = scope.id;
    const widgets = await app.listDashboardWidgets({ projectId });

    return { data: widgets.map((widget) => widgetResource(widget, platformUrl)) };
  })

  .post(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets",
    "postApiV1ProjectsByProjectIdAnalyticsDashboardWidgets",
  )
  .withParams(dashboardWidgetProjectParamsSchema)
  .withInput(createDashboardWidgetSchema)
  .withPermission("analytics:create")
  .withMiddleware(dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a dashboard widget",
    description:
      "Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query inside the sandbox, not at save.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      201: { description: "The widget was saved" },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = scope.id;
    const widget = await app.createDashboardWidget({
      projectId,
      name: input.name,
      code: input.code,
      queries: input.queries,
    });

    return widgetResource(widget, platformUrl);
  })

  .get(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
    "getApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
  )
  .withParams(dashboardWidgetParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Get a dashboard widget",
    description:
      "Returns one dashboard widget with its React source and named queries. A widget saved in another project is reported as not found.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The dashboard widget" },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = scope.id;
    const widget = await app.getDashboardWidget({ id: input.widgetId, projectId });

    return widgetResource(widget, platformUrl);
  })

  .patch(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
    "patchApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
  )
  .withParams(dashboardWidgetParamsSchema)
  .withInput(updateDashboardWidgetSchema)
  .withPermission("analytics:update")
  .withMiddleware(dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Update a dashboard widget",
    description:
      "Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are rewritten together — the graph blob holds them as one — so a request that offers one without the other, or neither field at all, is refused.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The updated widget" },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = scope.id;
    const { name, code, queries } = input;
    const widget = await app.updateDashboardWidget({
      id: input.widgetId,
      projectId,
      ...(name === undefined ? {} : { name }),
      ...(code === undefined ? {} : { code }),
      ...(queries === undefined ? {} : { queries }),
    });

    return widgetResource(widget, platformUrl);
  })

  .post(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId/dashboard",
    "postApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetIdDashboard",
  )
  .withParams(dashboardWidgetParamsSchema)
  .withInput(assignDashboardWidgetToDashboardSchema)
  .withPermission("analytics:update")
  .withMiddleware(dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Add a dashboard widget to a dashboard",
    description:
      "Assigns a dashboard widget to a dashboard. The widget is repositioned to the next free row on that dashboard; its size (colSpan/rowSpan) is preserved.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The widget was added to the dashboard" },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = scope.id;
    const widget = await app.assignDashboardWidgetToDashboard({
      id: input.widgetId,
      projectId,
      dashboardId: input.dashboardId,
    });

    return widgetResource(widget, platformUrl);
  })

  .delete(
    "/api/v1/projects/:projectId/analytics/dashboard-widgets/:widgetId",
    "deleteApiV1ProjectsByProjectIdAnalyticsDashboardWidgetsByWidgetId",
  )
  .withParams(dashboardWidgetParamsSchema)
  .withPermission("analytics:delete")
  .withOutput(z.void())
  .withDocs({
    summary: "Delete a dashboard widget",
    description:
      "Deletes one dashboard widget. Answers 204 with no body; deleting a widget that is not in this project is reported as not found.",
    tags: WIDGET_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      204: { description: "The widget was deleted", content: {} },
    },
  })
  .handle(async ({ app, input, scope }) => {
    const projectId = scope.id;

    await app.deleteDashboardWidget({ id: input.widgetId, projectId });
  })
  .build();
