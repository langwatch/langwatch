import { useMemo } from "react";
import { api } from "~/utils/api";
import type { PausedSchedule } from "./PausedSchedulesSection";

/** How many switched-off schedules the panel lists before it says so. */
const PAGE_SIZE = 50;

export interface PausedSchedulesResult {
  schedules: PausedSchedule[];
  /** Every switched-off schedule in the fleet, not just the listed page. */
  total: number;
}

/**
 * The switched-off schedules, asked for directly.
 *
 * The obvious implementation — read a page of `listScheduledJobs` and filter
 * it on `active` — is wrong in a way that hides itself: that read orders
 * `active DESC`, and Postgres sorts `true` above `false`, so the inactive
 * rows are precisely the ones its `LIMIT` drops. On any fleet with more
 * schedules than the page holds, the panel would report zero paused schedules
 * and look like it had checked. `listPausedSchedules` filters in SQL and
 * returns the fleet total alongside the page.
 */
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
