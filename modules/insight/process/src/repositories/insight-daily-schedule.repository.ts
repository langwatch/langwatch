import type { InsightDailyRun, InsightDailyRunSetting } from "@langwatch/insight-contract";

import type { InsightOnSchedule } from "../rules/insight-daily-schedule-row.rules.ts";

/**
 * Reads over the daily run rows. A person reads their own runs in a project and no others; only
 * the reconcile pass, which acts for no person, reads across projects.
 */
export interface InsightDailyScheduleRepository {
  /** The person's runs in the project, one per board, the newest run first. */
  findForUser(input: { projectId: string; userId: string }): Promise<InsightDailyRun[]>;
  /** The person's setting on one board: one entry, or none while they never decided. */
  findSetting(input: {
    projectId: string;
    userId: string;
    scheduleId: string;
  }): Promise<InsightDailyRunSetting[]>;
  /** One page of the schedules that are on, in every project, by id after `afterId`. */
  findOnPage(input: { afterId: string | null; take: number }): Promise<InsightOnSchedule[]>;
}
