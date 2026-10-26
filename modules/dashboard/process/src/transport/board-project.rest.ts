/**
 * The Dashboards area's boards under `/api/v1/projects/:projectId/analytics/boards`, read-only:
 * the boards a widget can be added to. `/api/v1/dashboards` manages them with the project taken
 * from the key; Analytics Reports boards are on `/api/v1/analytics/reports`.
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
} from "@langwatch/dashboard-contract";

import { viewerOfActor } from "../rules/dashboard-viewer.rules.ts";
import { boardResource } from "./board.rest.ts";

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

export const boardProjectRest = defineRestRouter(DashboardApi)
  .withNamespace("project-analytics-boards")
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
      "Lists this project's boards in the Dashboards area, each with how many widgets it holds. Pass a board's id to the dashboard widget's add-to-dashboard endpoint to place a widget on it. Analytics Reports boards are listed by /api/v1/analytics/reports instead.",
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
  .build();
