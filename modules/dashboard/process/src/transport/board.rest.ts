/**
 * The dashboards under `/api/v1/dashboards`, the project from the key, their widgets beneath.
 * 404 while `release_dashboards` is off (dashboards-v2.feature AC199l, AC199n to AC199q); bare
 * `/api/dashboards` answers too, deprecated (AC199v). Reports: /api/v1/analytics/reports.
 */
import { DashboardWidgetNotFoundError } from "@langwatch/analytics-contract";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineMiddlewareContext,
  DASHBOARDS_API_VERSION,
  defineRestRouter,
  nameUnlessMissing,
  resolver,
  type RouteResponse,
} from "@langwatch/api/rest";
import {
  boardIdParamsSchema,
  boardListSchema,
  boardResourceSchema,
  boardWidgetParamsSchema,
  createBoardSchema,
  createDashboardWidgetSchema,
  DashboardApi,
  dashboardDeletedResponseSchema,
  DashboardNotFoundError,
  DashboardsNotReleasedError,
  dashboardWidgetListSchema,
  dashboardWidgetResourceSchema,
  updateBoardSchema,
  updateDashboardWidgetSchema,
  type Board,
} from "@langwatch/dashboard-contract";
import { z } from "zod";

import { authorOfActor, viewerOfActor, viewerOfOwner } from "../rules/dashboard-viewer.rules.ts";
import {
  dashboardWidgetCallerSource,
  dashboardWidgetUrl,
  widgetResource,
} from "./dashboard-widget.rest.ts";

/**
 * `release_dashboards` for the key's project, resolved before the confirmation gate: while it is
 * off this family refuses as a path that does not exist, so a Langy key gets no card either.
 */
export const boardsReleased = defineMiddlewareContext("boardsReleased", z.literal(true));

/** The tags every operation in this file carries in the published document. */
const BOARD_TAGS = ["Dashboards"];

/** The `boardsReleased` value, or, while the flag is off, the refusal of a missing path. */
export function releasedOrRefused(released: boolean): true {
  if (!released) throw new DashboardsNotReleasedError();
  return true;
}

const boardNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description:
      "No dashboard with this id for this key. A dashboard made by POST /api/v1/analytics/reports is an Analytics Report and is not found here.",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

const widgetNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No dashboard with this id, or no widget with this id on that dashboard",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/** The board as the API publishes it. */
export function boardResource(
  board: Board,
  platformUrl: string,
): z.infer<typeof boardResourceSchema> {
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    scope: board.scope,
    excludedOrigins: board.excludedOrigins,
    createdById: board.createdById,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    platformUrl,
  };
}

export const boardRest = defineRestRouter(DashboardApi)
  .withNamespace("dashboards")
  .withVersion(DASHBOARDS_API_VERSION)
  .withAddressing("dated", { bareDeprecated: true })

  .get("/", "getApiDashboards")
  .withPermission("analytics:view")
  .withMiddlewareContext(boardsReleased)
  .withOutput(boardListSchema)
  .withDocs({
    summary: "List dashboards",
    description: "Lists the dashboards of the key's project, each with how many widgets it holds.",
    tags: BOARD_TAGS,
    responses: { ...canonicalBaseResponses, 200: { description: "The project's dashboards" } },
  })
  .handle(async ({ app, scope, actor }) => {
    const projectId = scope.id;
    const boards = await app.findBoards({ projectId, ...viewerOfActor({ actor }) });
    const links = await app.getBoardLinks({
      projectId,
      dashboardIds: boards.map((board) => board.id),
    });

    return {
      data: boards.map((board) => ({
        ...boardResource(board, links[board.id] ?? ""),
        widgetCount: board.graphCount,
      })),
    };
  })

  .post("/", "postApiDashboards")
  .keepsRecords()
  .withAudit("boards.create")
  .withInput(createBoardSchema)
  .withPermission("analytics:create")
  .withMiddlewareContext(boardsReleased)
  .withOutput(boardResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a dashboard",
    description:
      "Creates an empty dashboard in the key's project. Add widgets to it with POST /api/v1/dashboards/{dashboardId}/widgets.",
    tags: BOARD_TAGS,
    responses: { ...canonicalBaseResponses, 201: { description: "The dashboard was created" } },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const projectId = scope.id;
    const board = await app.createBoard({
      projectId,
      name: input.name,
      ...authorOfActor({ actor }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .get("/:dashboardId", "getApiDashboardsByDashboardId")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(boardsReleased)
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Get a dashboard",
    description: "Returns one dashboard.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The dashboard" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const projectId = scope.id;
    const board = await app.getBoard({
      projectId,
      dashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .patch("/:dashboardId", "patchApiDashboardsByDashboardId")
  .keepsRecords()
  .withAudit("boards.update")
  .withParams(boardIdParamsSchema)
  .withInput(updateBoardSchema)
  .withPermission("analytics:update")
  .withMiddlewareContext(boardsReleased)
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Update a dashboard",
    description:
      "Changes a dashboard's name, description or the trace origins its widgets leave out when they set none of their own; a field the body leaves out keeps its value. A null description clears it; excludedOrigins [] includes Langy's traces, and null restores the default (Langy's left out, none in a personal project).",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The updated dashboard" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const projectId = scope.id;
    const board = await app.updateBoard({
      projectId,
      dashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.excludedOrigins === undefined ? {} : { excludedOrigins: input.excludedOrigins }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .delete("/:dashboardId", "deleteApiDashboardsByDashboardId")
  .withAudit("boards.delete")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:delete")
  .withConfirmation({
    resource: "board",
    action: "delete",
    idParam: "dashboardId",
    name: ({ app, projectId, id, ownerUserId }) =>
      nameUnlessMissing({
        read: app.getBoard({ projectId, dashboardId: id, ...viewerOfOwner({ ownerUserId }) }),
        missing: DashboardNotFoundError,
        nameOf: (board) => board.name,
      }),
  })
  .withMiddlewareContext(boardsReleased)
  .withOutput(dashboardDeletedResponseSchema)
  .withDocs({
    summary: "Delete a dashboard",
    description:
      "Deletes a dashboard together with the widgets on it and every member's star of it; this cannot be undone. Answers with the deleted dashboard's id and name.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The dashboard was deleted" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const board = await app.deleteBoard({
      projectId: scope.id,
      dashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
    });

    return { id: board.id, name: board.name };
  })

  .get("/:dashboardId/widgets", "getApiDashboardsByDashboardIdWidgets")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardWidgetUrl, boardsReleased)
  .withOutput(dashboardWidgetListSchema)
  .withDocs({
    summary: "List a dashboard's widgets",
    description:
      "Lists the widgets on one dashboard, each with its React source and named queries.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The dashboard's widgets" },
    },
  })
  .handle(async ({ app, input, scope, actor }, platformUrl) => {
    const widgets = await app.listDashboardWidgets({
      projectId: scope.id,
      dashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
    });

    return { data: widgets.map((widget) => widgetResource(widget, platformUrl)) };
  })

  .post("/:dashboardId/widgets", "postApiDashboardsByDashboardIdWidgets")
  .keepsRecords()
  .withAudit("boardWidgets.create")
  .withParams(boardIdParamsSchema)
  .withInput(createDashboardWidgetSchema)
  .withPermission("analytics:create")
  .withMiddlewareContext(dashboardWidgetUrl, dashboardWidgetCallerSource, boardsReleased)
  .withOutput(dashboardWidgetResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a widget on a dashboard",
    description:
      "Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this dashboard at the next free row. `source` records where the widget came from; without it, the widget is recorded as made through the API. `excludedOrigins` is the widget's Langy traces setting: [] counts Langy's traces, [\"langy\"] leaves them out, and without it the widget follows the dashboard.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      201: { description: "The widget was saved on the dashboard" },
    },
  })
  .handle(async ({ app, input, scope, actor }, platformUrl, source) => {
    const widget = await app.createDashboardWidget({
      projectId: scope.id,
      dashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
      name: input.name,
      code: input.code,
      queries: input.queries,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.excludedOrigins === undefined ? {} : { excludedOrigins: input.excludedOrigins }),
      source: input.source ?? source,
    });

    return widgetResource(widget, platformUrl);
  })

  .get("/:dashboardId/widgets/:widgetId", "getApiDashboardsByDashboardIdWidgetsByWidgetId")
  .withParams(boardWidgetParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardWidgetUrl, boardsReleased)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Get a widget on a dashboard",
    description: "Returns one widget on this dashboard with its React source and named queries.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The widget" },
    },
  })
  .handle(async ({ app, input, scope, actor }, platformUrl) => {
    const widget = await app.getDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
    });

    return widgetResource(widget, platformUrl);
  })

  .patch("/:dashboardId/widgets/:widgetId", "patchApiDashboardsByDashboardIdWidgetsByWidgetId")
  .keepsRecords()
  .withAudit("boardWidgets.update")
  .withParams(boardWidgetParamsSchema)
  .withInput(updateDashboardWidgetSchema)
  .withPermission("analytics:update")
  .withMiddlewareContext(dashboardWidgetUrl, boardsReleased)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Update a widget on a dashboard",
    description:
      "Changes a widget's name, code, queries, description, source or excludedOrigins (its Langy traces setting). A field the body leaves out keeps its stored value. A body with none of these fields is refused.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The updated widget" },
    },
  })
  .handle(async ({ app, input, scope, actor }, platformUrl) => {
    const { name, code, queries, description, source, excludedOrigins } = input;
    const widget = await app.updateDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
      ...(name === undefined ? {} : { name }),
      ...(code === undefined ? {} : { code }),
      ...(queries === undefined ? {} : { queries }),
      ...(description === undefined ? {} : { description }),
      ...(source === undefined ? {} : { source }),
      ...(excludedOrigins === undefined ? {} : { excludedOrigins }),
    });

    return widgetResource(widget, platformUrl);
  })

  .delete("/:dashboardId/widgets/:widgetId", "deleteApiDashboardsByDashboardIdWidgetsByWidgetId")
  .withAudit("boardWidgets.delete")
  .withParams(boardWidgetParamsSchema)
  .withPermission("analytics:delete")
  .withConfirmation({
    resource: "dashboard widget",
    action: "delete",
    idParam: "widgetId",
    name: ({ app, projectId, id, ownerUserId, input }) =>
      nameUnlessMissing({
        read: app.getDashboardWidget({
          projectId,
          id,
          onDashboardId: boardIdParamsSchema.parse(input).dashboardId,
          ...viewerOfOwner({ ownerUserId }),
        }),
        missing: DashboardWidgetNotFoundError,
        nameOf: (widget) => widget.name,
      }),
  })
  .withMiddlewareContext(boardsReleased)
  .withOutput(z.void())
  .withDocs({
    summary: "Delete a widget on a dashboard",
    description: "Deletes one widget on this dashboard. Answers 204 with no body.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      204: { description: "The widget was deleted", content: {} },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    await app.deleteDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.dashboardId,
      ...viewerOfActor({ actor }),
    });
  })
  .build();
