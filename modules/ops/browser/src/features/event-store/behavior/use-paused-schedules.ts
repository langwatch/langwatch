import { useMemo } from "react";

import { api } from "../../../behavior/ops-api.ts";
import type { PausedSchedule } from "../model/paused-schedule.ts";

/** How many switched-off schedules the panel lists before it says so. */
const PAGE_SIZE = 50;

export interface PausedSchedulesResult {
  schedules: PausedSchedule[];
  /** Every switched-off schedule in the fleet, not just the listed page. */
  total: number;
}

/** Needs dedicated endpoint; filtering listScheduledJobs drops inactive rows (ordered
 * active DESC, so LIMIT hides them). listPausedSchedules filters in SQL. */
export function usePausedSchedules(): PausedSchedulesResult {
  const query = api.ops.listPausedSchedules.useQuery(
    { limit: PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

  const rows = query.data?.schedules;
  const schedules = useMemo<PausedSchedule[]>(
    () =>
      (rows ?? []).map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        cron: row.cron,
      })),
    [rows],
  );

  return { schedules, total: query.data?.total ?? 0 };
}
