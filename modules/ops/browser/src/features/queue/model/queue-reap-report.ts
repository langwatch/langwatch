import type { OpsQueueReapedStrandedGroups } from "@langwatch/ops-contract";

/** The one line an operator reads after clearing stuck groups. */
export function describeReapReport(report: OpsQueueReapedStrandedGroups): string {
  if (report.strandedGroups === 0) return "No stuck groups found";
  const parts = [
    `Cleared ${report.deletedGroups} of ${report.strandedGroups} stuck groups (${report.strandedJobs} jobs)`,
  ];
  if (report.failedDeletes > 0) parts.push(`${report.failedDeletes} could not be deleted`);
  if (report.totalPendingNow !== null) parts.push(`${report.totalPendingNow} jobs pending now`);
  return parts.join("; ");
}
