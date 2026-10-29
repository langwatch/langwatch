/**
 * The Dashboards area's dashboards under `/api/v1/projects/:projectId/analytics/dashboards`,
 * read-only: the dashboards a widget can be added to. `/analytics/boards` is the old, deprecated
 * spelling (AC199y). `/api/v1/dashboards` manages them; Analytics Reports: `/analytics/reports`.
 */
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDocs,
  type RouteResponse,
} from "@langwatch/api/rest";
import type { Actor } from "@langwatch/authorization";
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
    description: "No dashboard with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/** The project analytics paths stay in project's namespace for good (§8, ruling 2026-10-05). */
const PROJECT_ANALYTICS = {
  owner: "project",
  reason: "dashboard serves the project's analytics sub-resource under its project path",
  permanent: true,
} as const;

const DASHBOARDS_PATH = "/api/v1/projects/{projectId}/analytics/dashboards";

/** The old spelling answers the same, deprecated in favour of `/analytics/dashboards`. */
const DEPRECATED_BOARDS_PATH = {
  successor: DASHBOARDS_PATH,
  notice: "Use /api/v1/projects/{projectId}/analytics/dashboards; /analytics/boards is deprecated",
} as const;

const listDocs: RestTransportDocs = {
  summary: "List dashboards",
  description:
    "Lists this project's dashboards in the Dashboards area, each with how many widgets it holds. Pass a dashboard's id to the dashboard widget's add-to-dashboard endpoint to place a widget on it. Analytics Reports are listed by /api/v1/analytics/reports instead.",
  tags: BOARD_TAGS,
  responses: {
    ...canonicalBaseResponses,
    200: { description: "The project's dashboards" },
  },
};

const getDocs: RestTransportDocs = {
  summary: "Get a dashboard",
  description:
    "Returns one dashboard of the Dashboards area. A dashboard saved in another project, or one only Analytics Reports holds, is reported as not found.",
  tags: BOARD_TAGS,
  responses: {
    ...canonicalBaseResponses,
    ...boardNotFoundResponse,
    200: { description: "The dashboard" },
  },
};

async function listDashboards({
  app,
  scope,
  actor,
}: Readonly<{ app: DashboardApi; scope: { id: string }; actor: Actor | null }>) {
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
}

async function getDashboard({
  app,
  input,
  scope,
  actor,
}: Readonly<{
  app: DashboardApi;
  input: { dashboardId: string };
  scope: { id: string };
  actor: Actor | null;
}>) {
  const projectId = scope.id;
  const board = await app.getBoard({
    projectId,
    dashboardId: input.dashboardId,
    ...viewerOfActor({ actor }),
  });
  const links = await app.getBoardLinks({ projectId, dashboardIds: [board.id] });

  return boardResource(board, links[board.id] ?? "");
}

export const boardProjectRest = defineRestRouter(DashboardApi)
  .withNamespace("project-analytics-boards")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get(
    "/api/v1/projects/:projectId/analytics/dashboards",
    "getApiV1ProjectsByProjectIdAnalyticsDashboards",
  )
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardProjectParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardListSchema)
  .withDocs(listDocs)
  .handle(({ app, scope, actor }) => listDashboards({ app, scope, actor }))

  .get(
    "/api/v1/projects/:projectId/analytics/dashboards/:dashboardId",
    "getApiV1ProjectsByProjectIdAnalyticsDashboardsByDashboardId",
  )
  .withSharedPath(PROJECT_ANALYTICS)
  .withParams(boardParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardResourceSchema)
  .withDocs(getDocs)
  .handle(({ app, input, scope, actor }) => getDashboard({ app, input, scope, actor }))

  .get("/api/v1/projects/:projectId/analytics/boards", "getApiV1ProjectsByProjectIdAnalyticsBoards")
  .withSharedPath(PROJECT_ANALYTICS)
  .withDeprecated(DEPRECATED_BOARDS_PATH)
  .withParams(boardProjectParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardListSchema)
  .withDocs(listDocs)
  .handle(({ app, scope, actor }) => listDashboards({ app, scope, actor }))

  .get(
    "/api/v1/projects/:projectId/analytics/boards/:dashboardId",
    "getApiV1ProjectsByProjectIdAnalyticsBoardsByDashboardId",
  )
  .withSharedPath(PROJECT_ANALYTICS)
  .withDeprecated({ ...DEPRECATED_BOARDS_PATH, successor: `${DASHBOARDS_PATH}/{dashboardId}` })
  .withParams(boardParamsSchema)
  .withPermission("analytics:view")
  .withOutput(boardResourceSchema)
  .withDocs(getDocs)
  .handle(({ app, input, scope, actor }) => getDashboard({ app, input, scope, actor }))
  .build();
