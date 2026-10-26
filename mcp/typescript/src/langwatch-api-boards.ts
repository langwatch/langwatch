import type {
  DashboardWidget,
  DashboardWidgetQueryInput,
} from "./langwatch-api-dashboard-widgets.js";
import { makeRequest } from "./langwatch-api.js";

/**
 * A board in the Dashboards area, at `/api/v1/boards`; the project comes from the API key
 * (`modules/dashboard/contract/src/board-rest.schemas.ts`). Every route answers 404 while
 * Dashboards is off for the key's project. Analytics Reports boards are `/api/v1/dashboards`.
 */
export interface Board {
  id: string;
  name: string;
  description: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

export interface BoardListItem extends Board {
  widgetCount: number;
}

const boardPath = (boardId: string) => `/api/v1/boards/${encodeURIComponent(boardId)}`;
const widgetPath = (boardId: string, widgetId: string) =>
  `${boardPath(boardId)}/widgets/${encodeURIComponent(widgetId)}`;

/** The key's project's Dashboards boards, each with how many widgets it holds. */
export async function listBoards(): Promise<{ data: BoardListItem[] }> {
  return makeRequest("GET", "/api/v1/boards") as Promise<{ data: BoardListItem[] }>;
}

/** The same list at the deprecated project path, which answers while Dashboards is off too. */
export async function listProjectBoards({
  projectId,
}: {
  projectId: string;
}): Promise<{ data: BoardListItem[] }> {
  return makeRequest(
    "GET",
    `/api/v1/projects/${encodeURIComponent(projectId)}/analytics/boards`,
  ) as Promise<{ data: BoardListItem[] }>;
}

/** One board at the deprecated project path, which answers while Dashboards is off too. */
export async function getProjectBoard({
  projectId,
  boardId,
}: {
  projectId: string;
  boardId: string;
}): Promise<Board> {
  return makeRequest(
    "GET",
    `/api/v1/projects/${encodeURIComponent(projectId)}/analytics/boards/${encodeURIComponent(boardId)}`,
  ) as Promise<Board>;
}

/** Reads one Dashboards board; a board in another project, or only in Reports, answers 404. */
export async function getBoard({ boardId }: { boardId: string }): Promise<Board> {
  return makeRequest("GET", boardPath(boardId)) as Promise<Board>;
}

export async function createBoard({ name }: { name: string }): Promise<Board> {
  return makeRequest("POST", "/api/v1/boards", { name }) as Promise<Board>;
}

/** A field left out keeps its value; a `null` description clears it. */
export async function updateBoard({
  boardId,
  ...changes
}: {
  boardId: string;
  name?: string;
  description?: string | null;
}): Promise<Board> {
  return makeRequest("PATCH", boardPath(boardId), changes) as Promise<Board>;
}

/** Deletes the board with the widgets on it. */
export async function deleteBoard({
  boardId,
}: {
  boardId: string;
}): Promise<{ id: string; name: string }> {
  return makeRequest("DELETE", boardPath(boardId)) as Promise<{ id: string; name: string }>;
}

export async function listBoardWidgets({
  boardId,
}: {
  boardId: string;
}): Promise<{ data: DashboardWidget[] }> {
  return makeRequest("GET", `${boardPath(boardId)}/widgets`) as Promise<{
    data: DashboardWidget[];
  }>;
}

/** Saves a widget placed on this board at the next free row. */
export async function createBoardWidget({
  boardId,
  ...data
}: {
  boardId: string;
  name: string;
  code: string;
  queries: DashboardWidgetQueryInput[];
  description?: string;
}): Promise<DashboardWidget> {
  return makeRequest("POST", `${boardPath(boardId)}/widgets`, data) as Promise<DashboardWidget>;
}

/** A widget on any other board answers 404. */
export async function getBoardWidget({
  boardId,
  widgetId,
}: {
  boardId: string;
  widgetId: string;
}): Promise<DashboardWidget> {
  return makeRequest("GET", widgetPath(boardId, widgetId)) as Promise<DashboardWidget>;
}

export async function updateBoardWidget({
  boardId,
  widgetId,
  ...changes
}: {
  boardId: string;
  widgetId: string;
  name?: string;
  code?: string;
  queries?: DashboardWidgetQueryInput[];
  description?: string;
}): Promise<DashboardWidget> {
  return makeRequest("PATCH", widgetPath(boardId, widgetId), changes) as Promise<DashboardWidget>;
}

export async function deleteBoardWidget({
  boardId,
  widgetId,
}: {
  boardId: string;
  widgetId: string;
}): Promise<void> {
  await makeRequest("DELETE", widgetPath(boardId, widgetId));
}
