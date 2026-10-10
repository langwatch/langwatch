import type { InsightDailyRun } from "@langwatch/insight-contract";

/**
 * Reads over the daily run rows. A person reads their own runs in a project and no others.
 */
export interface InsightDailyScheduleRepository {
  /** The person's runs in the project, one per board, the newest run first. */
  findForUser(input: { projectId: string; userId: string }): Promise<InsightDailyRun[]>;
}
