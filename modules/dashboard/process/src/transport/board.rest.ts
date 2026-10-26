/**
 * The Dashboards area's boards under `/api/v1/boards`, the project taken from the key, with a
 * board's widgets as its sub-resource. Not there while `release_dashboards` is off for the key's
 * project (dashboards-v2.feature AC199l, AC199n to AC199q). Reports boards: /api/v1/dashboards.
 */
import { DashboardWidgetNotFoundError, type DashboardWidget } from "@langwatch/analytics-contract";
import { dashboardWidgetSourceSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
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
  type Dashboard,
} from "@langwatch/dashboard-contract";
import { z } from "zod";

import { authorOfActor, viewerOfActor, viewerOfOwner } from "../rules/dashboard-viewer.rules.ts";
import { dashboardWidgetUrl } from "./dashboard-widget.rest.ts";

/** Whether `release_dashboards` is on for the key's project, read on each request. */
export const dashboardsReleased = defineMiddlewareContext("dashboardsReleased", z.boolean());

/** A new widget's deep link and the source it records when its body names none. */
export const boardWidgetCaller = defineMiddlewareContext(
  "boardWidgetCaller",
  z.object({ platformUrl: z.string(), source: dashboardWidgetSourceSchema }),
);

/** Where the routes this family supersedes point a caller (dashboards-v2.feature AC199r). */
export const BOARDS_SUCCESSOR = "/api/v1/boards";

/** The tags every operation in this file carries in the published document. */
const BOARD_TAGS = ["Dashboards / Boards"];

/** While the flag is off the family answers as a path that does not exist. */
function assertReleased(released: boolean): void {
  if (!released) throw new DashboardsNotReleasedError();
}

const boardNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description:
      "No Dashboards board with this id for this key. A board made by POST /api/v1/dashboards is an Analytics Reports board and is not found here.",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

const widgetNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No Dashboards board with this id, or no widget with this id on that board",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/** The board as the API publishes it. */
export function boardResource(
  board: Dashboard,
  platformUrl: string,
): z.infer<typeof boardResourceSchema> {
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    scope: board.scope,
    createdById: board.createdById,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    platformUrl,
  };
}

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

export const boardRest = defineRestRouter(DashboardApi)
  .withNamespace("boards")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "getApiBoards")
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(boardListSchema)
  .withDocs({
    summary: "List boards",
    description:
      "Lists the Dashboards boards of the key's project, each with how many widgets it holds.",
    tags: BOARD_TAGS,
    responses: { ...canonicalBaseResponses, 200: { description: "The project's boards" } },
  })
  .handle(async ({ app, scope, actor }, released) => {
    assertReleased(released);
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

  .post("/", "postApiBoards")
  .keepsRecords()
  .withAudit("boards.create")
  .withInput(createBoardSchema)
  .withPermission("analytics:create")
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(boardResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a board",
    description:
      "Creates an empty Dashboards board in the key's project. Add widgets to it with POST /api/v1/boards/{boardId}/widgets.",
    tags: BOARD_TAGS,
    responses: { ...canonicalBaseResponses, 201: { description: "The board was created" } },
  })
  .handle(async ({ app, input, scope, actor }, released) => {
    assertReleased(released);
    const projectId = scope.id;
    const board = await app.createBoard({
      projectId,
      name: input.name,
      ...authorOfActor({ actor }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .get("/:boardId", "getApiBoardsByBoardId")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Get a board",
    description: "Returns one Dashboards board.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The board" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released) => {
    assertReleased(released);
    const projectId = scope.id;
    const board = await app.getBoard({
      projectId,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .patch("/:boardId", "patchApiBoardsByBoardId")
  .keepsRecords()
  .withAudit("boards.update")
  .withParams(boardIdParamsSchema)
  .withInput(updateBoardSchema)
  .withPermission("analytics:update")
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Update a board",
    description:
      "Changes a board's name or description; a field the body leaves out keeps its value, and a null description clears it.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The updated board" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released) => {
    assertReleased(released);
    const projectId = scope.id;
    const board = await app.updateBoard({
      projectId,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .delete("/:boardId", "deleteApiBoardsByBoardId")
  .withAudit("boards.delete")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:delete")
  .withConfirmation({
    resource: "board",
    action: "delete",
    idParam: "boardId",
    name: ({ app, projectId, id, ownerUserId }) =>
      nameUnlessMissing({
        read: app.getBoard({ projectId, dashboardId: id, ...viewerOfOwner({ ownerUserId }) }),
        missing: DashboardNotFoundError,
        nameOf: (board) => board.name,
      }),
  })
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(dashboardDeletedResponseSchema)
  .withDocs({
    summary: "Delete a board",
    description:
      "Deletes a board together with the widgets on it and every member's star of it; this cannot be undone. Answers with the deleted board's id and name.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The board was deleted" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released) => {
    assertReleased(released);
    const board = await app.deleteBoard({
      projectId: scope.id,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });

    return { id: board.id, name: board.name };
  })

  .get("/:boardId/widgets", "getApiBoardsByBoardIdWidgets")
  .withParams(boardIdParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardsReleased, dashboardWidgetUrl)
  .withOutput(dashboardWidgetListSchema)
  .withDocs({
    summary: "List a board's widgets",
    description: "Lists the widgets on one board, each with its React source and named queries.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The board's widgets" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released, platformUrl) => {
    assertReleased(released);
    const widgets = await app.listDashboardWidgets({
      projectId: scope.id,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });

    return { data: widgets.map((widget) => widgetResource(widget, platformUrl)) };
  })

  .post("/:boardId/widgets", "postApiBoardsByBoardIdWidgets")
  .keepsRecords()
  .withAudit("boardWidgets.create")
  .withParams(boardIdParamsSchema)
  .withInput(createDashboardWidgetSchema)
  .withPermission("analytics:create")
  .withMiddlewareContext(dashboardsReleased, boardWidgetCaller)
  .withOutput(dashboardWidgetResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a widget on a board",
    description:
      "Saves a React source file and the named LangWatchQL queries it runs as one widget, placed on this board at the next free row. `source` records where the widget came from; without it, the widget is recorded as made through the API.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      201: { description: "The widget was saved on the board" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released, { platformUrl, source }) => {
    assertReleased(released);
    const widget = await app.createDashboardWidget({
      projectId: scope.id,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
      name: input.name,
      code: input.code,
      queries: input.queries,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      source: input.source ?? source,
    });

    return widgetResource(widget, platformUrl);
  })

  .get("/:boardId/widgets/:widgetId", "getApiBoardsByBoardIdWidgetsByWidgetId")
  .withParams(boardWidgetParamsSchema)
  .withPermission("analytics:view")
  .withMiddlewareContext(dashboardsReleased, dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Get a widget on a board",
    description: "Returns one widget on this board with its React source and named queries.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The widget" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released, platformUrl) => {
    assertReleased(released);
    const widget = await app.getDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });

    return widgetResource(widget, platformUrl);
  })

  .patch("/:boardId/widgets/:widgetId", "patchApiBoardsByBoardIdWidgetsByWidgetId")
  .keepsRecords()
  .withAudit("boardWidgets.update")
  .withParams(boardWidgetParamsSchema)
  .withInput(updateDashboardWidgetSchema)
  .withPermission("analytics:update")
  .withMiddlewareContext(dashboardsReleased, dashboardWidgetUrl)
  .withOutput(dashboardWidgetResourceSchema)
  .withDocs({
    summary: "Update a widget on a board",
    description:
      "Changes a widget's name, code, queries, description or source. A field the body leaves out keeps its stored value. A body with none of these fields is refused.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      200: { description: "The updated widget" },
    },
  })
  .handle(async ({ app, input, scope, actor }, released, platformUrl) => {
    assertReleased(released);
    const { name, code, queries, description, source } = input;
    const widget = await app.updateDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.boardId,
      ...viewerOfActor({ actor }),
      ...(name === undefined ? {} : { name }),
      ...(code === undefined ? {} : { code }),
      ...(queries === undefined ? {} : { queries }),
      ...(description === undefined ? {} : { description }),
      ...(source === undefined ? {} : { source }),
    });

    return widgetResource(widget, platformUrl);
  })

  .delete("/:boardId/widgets/:widgetId", "deleteApiBoardsByBoardIdWidgetsByWidgetId")
  .withAudit("boardWidgets.delete")
  .withParams(boardWidgetParamsSchema)
  .withPermission("analytics:delete")
  .withConfirmation({
    resource: "dashboard widget",
    action: "delete",
    idParam: "widgetId",
    name: ({ app, projectId, id, ownerUserId }) =>
      nameUnlessMissing({
        read: app.getDashboardWidget({ projectId, id, ...viewerOfOwner({ ownerUserId }) }),
        missing: DashboardWidgetNotFoundError,
        nameOf: (widget) => widget.name,
      }),
  })
  .withMiddlewareContext(dashboardsReleased)
  .withOutput(z.void())
  .withDocs({
    summary: "Delete a widget on a board",
    description: "Deletes one widget on this board. Answers 204 with no body.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...widgetNotFoundResponse,
      204: { description: "The widget was deleted", content: {} },
    },
  })
  .handle(async ({ app, input, scope, actor }, released) => {
    assertReleased(released);
    await app.deleteDashboardWidget({
      projectId: scope.id,
      id: input.widgetId,
      onDashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });
  })
  .build();
