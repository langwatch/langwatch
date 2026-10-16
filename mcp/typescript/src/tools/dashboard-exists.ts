import { getBoard } from "../langwatch-api-boards.js";
import { LangWatchApiError } from "../langwatch-api.js";

/**
 * Refuses a dashboard id that names no Dashboards board in this project, naming the id, so an
 * agent's typo, or the id of an Analytics Reports board, fails before any widget is written.
 */
export async function assertDashboardExists({
  projectId,
  dashboardId,
}: {
  projectId: string;
  dashboardId: string;
}): Promise<void> {
  try {
    await getBoard({ projectId, boardId: dashboardId });
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No dashboard with ID "${dashboardId}" was found in this project. Use list_dashboard_boards to find a valid dashboard ID.`,
      );
    }
    throw error;
  }
}
