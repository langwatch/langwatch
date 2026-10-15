import { getDashboard } from "../langwatch-api-dashboards.js";
import { LangWatchApiError } from "../langwatch-api.js";

/**
 * Refuses a dashboard id that names no dashboard in this project, naming the id, so an
 * agent's typo fails before any widget is written.
 */
export async function assertDashboardExists({
  dashboardId,
}: {
  dashboardId: string;
}): Promise<void> {
  try {
    await getDashboard(dashboardId);
  } catch (error) {
    if (error instanceof LangWatchApiError && error.status === 404) {
      throw new Error(
        `No dashboard with ID "${dashboardId}" was found in this project. Use platform_list_dashboards to find a valid dashboard ID.`,
      );
    }
    throw error;
  }
}
