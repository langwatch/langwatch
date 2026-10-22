import { makeRequest } from "./langwatch-api.js";

/**
 * A board in the Dashboards area, the place a widget is added to
 * (`modules/dashboard/contract/src/board-rest.schemas.ts`). Analytics Reports boards are
 * `/api/v1/dashboards`, and hold no widget.
 */
export interface Board {
  id: string;
  name: string;
  description: string | null;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

export interface BoardListItem extends Board {
  widgetCount: number;
}

/** The project's Dashboards boards, each with how many widgets it holds. */
export async function listBoards({
  projectId,
}: {
  projectId: string;
}): Promise<{ data: BoardListItem[] }> {
  return makeRequest(
    "GET",
    `/api/v1/projects/${encodeURIComponent(projectId)}/analytics/boards`,
  ) as Promise<{ data: BoardListItem[] }>;
}

/** Reads one Dashboards board; a board in another project, or only in Reports, answers 404. */
export async function getBoard({
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
