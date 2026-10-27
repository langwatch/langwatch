import { getBoard, getProjectBoard } from "../langwatch-api-boards.js";
import { LangWatchApiError } from "../langwatch-api.js";

const isNotFound = (error: unknown) => error instanceof LangWatchApiError && error.status === 404;

/**
 * Whether /api/v1/dashboards/{id} answers for this id. A 404 means the board routes are off for the
 * project (Dashboards switched off) or the id is unknown; the caller then takes the project-path
 * routes, whose own check refuses an unknown id.
 */
export async function isOnBoardRoutes({ dashboardId }: { dashboardId: string }): Promise<boolean> {
  try {
    await getBoard({ boardId: dashboardId });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Refuses a dashboard id that names no Dashboards board in this project, naming the id, so an
 * agent's typo, or the id of an Analytics Reports board, fails before any widget is written.
 */
export async function assertProjectDashboardExists({
  projectId,
  dashboardId,
}: {
  projectId: string;
  dashboardId: string;
}): Promise<void> {
  try {
    await getProjectBoard({ projectId, boardId: dashboardId });
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `No dashboard with ID "${dashboardId}" was found in this project. Use list_dashboard_boards to find a valid dashboard ID.`,
      );
    }
    throw error;
  }
}
