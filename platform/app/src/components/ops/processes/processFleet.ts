import { formatTimeAgo } from "@langwatch/ops-web";
import type { ProcessFleetSummary } from "~/server/app-layer/ops/manager-explorer.service";

/** Anything the summary counted as wrong — decides row tinting. */
export function hasFleetTrouble(row: ProcessFleetSummary): boolean {
  return (
    row.deadMessages > 0 ||
    row.lapsedLeases > 0 ||
    row.overduePending > 0 ||
    row.overdueWakes > 0
  );
}

/**
 * A wake instant, as the operator needs to read it: a future wake is a
 * countdown, a past-due wake is an AGE ("due 3m ago") — a bare countdown
 * shape for an overdue wake would read as scheduled rather than as stuck.
 */
export function describeNextWake(
  nextWakeAt: number | null,
  now = Date.now(),
): string {
  if (nextWakeAt === null) return "none";
  if (nextWakeAt > now) return formatTimeAgo(nextWakeAt, now);
  return `due ${formatTimeAgo(nextWakeAt, now)}`;
}
