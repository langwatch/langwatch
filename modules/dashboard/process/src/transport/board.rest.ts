/**
 * The Dashboards area's boards under `/api/v1/projects/:projectId/analytics/boards`: read,
 * create and delete the boards a dashboard widget can be added to. Analytics Reports boards stay on
 * `/api/v1/dashboards` (dashboards-v2.feature AC199).
 */
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RouteResponse,
} from "@langwatch/api/rest";
import {
  boardListSchema,
  boardParamsSchema,
  boardProjectParamsSchema,
  boardResourceSchema,
  DashboardApi,
  dashboardRestNameSchema,
  type Dashboard,
} from "@langwatch/dashboard-contract";
import type { z } from "zod";

import { viewerOfActor } from "../rules/dashboard-viewer.rules.ts";

/** The tags every operation in this file carries in the published document. */
const BOARD_TAGS = ["Analytics / LangWatchQL"];

/** A missing id, another project's board and an Analytics Reports board alike. */
const boardNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No Dashboards board with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/** The project analytics paths stay in project's namespace for good (§8, ruling 2026-10-05). */
const PROJECT_ANALYTICS = {
  owner: "project",
  reason: "dashboard serves the project's analytics sub-resource under its project path",
  permanent: true,
} as const;

/** The board as the API publishes it. */
function boardResource(board: Dashboard, platformUrl: string): z.infer<typeof boardResourceSchema> {
  return {
    id: board.id,
    name: board.name,
    description: board.description,
    scope: board.scope,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    platformUrl,
  };
}

export const boardRest = defineRestRouter(DashboardApi)
  .withNamespace("boards")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get("/api/v1/projects/:projectId/analytics/boards", "getApiV1ProjectsByProjectIdAnalyticsBoards")
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardProjectParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardListSchema)
  .withDocs({
    summary: "List Dashboards boards",
    description:
      "Lists this project's boards in the Dashboards area, each with how many widgets it holds. Pass a board's id to the dashboard widget's add-to-dashboard endpoint to place a widget on it. Analytics Reports boards are listed by /api/v1/dashboards instead.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: { description: "The project's Dashboards boards" },
    },
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

  .get(
    "/api/v1/projects/:projectId/analytics/boards/:boardId",
    "getApiV1ProjectsByProjectIdAnalyticsBoardsByBoardId",
  )
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Get a Dashboards board",
    description:
      "Returns one board of the Dashboards area. A board saved in another project, or one only Analytics Reports holds, is reported as not found.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The Dashboards board" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const projectId = scope.id;
    const board = await app.getBoard({
      projectId,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .post(
    "/api/v1/projects/:projectId/analytics/boards",
    "postApiV1ProjectsByProjectIdAnalyticsBoards",
  )
  .withAudit("boards.create")
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardProjectParamsSchema)
  .withInput(dashboardRestNameSchema)
  .withPermission("analytics:create")
  .withOutput(boardResourceSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a Dashboards board",
    description:
      "Creates an empty board in the Dashboards area. Pass its id to the dashboard widget's add-to-dashboard endpoint to place a widget on it. A board made by POST /api/dashboards belongs to Analytics Reports and cannot hold dashboard widgets.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      201: { description: "The board was created" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const projectId = scope.id;
    const board = await app.createBoard({
      projectId,
      name: input.name,
      ...(actor?.type === "user" ? { createdById: actor.id } : {}),
    });
    const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

    return boardResource(board, links[board.id] ?? "");
  })

  .delete(
    "/api/v1/projects/:projectId/analytics/boards/:boardId",
    "deleteApiV1ProjectsByProjectIdAnalyticsBoardsByBoardId",
  )
  .withAudit("boards.delete")
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardParamsSchema)
  .withPermission("analytics:delete")
  .withOutput(boardResourceSchema)
  .withDocs({
    summary: "Delete a Dashboards board",
    description:
      "Deletes a board of the Dashboards area. Its widgets stay saved and become unplaced. A board saved in another project, or one only Analytics Reports holds, is reported as not found.",
    tags: BOARD_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...boardNotFoundResponse,
      200: { description: "The board was deleted" },
    },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const board = await app.deleteBoard({
      projectId: scope.id,
      dashboardId: input.boardId,
      ...viewerOfActor({ actor }),
    });

    return boardResource(board, "");
  })
  .build();
