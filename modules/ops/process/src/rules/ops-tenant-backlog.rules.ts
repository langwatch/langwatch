import type { QueueInfo } from "@langwatch/ops-contract";

/**
 * Jobs waiting per tenant across one scan's groups. Every eventing group id opens with
 * `<tenantId>/`; a group without that prefix names no tenant and is left out.
 */
export function countWaitingJobsByTenant({
  queues,
}: {
  queues: readonly QueueInfo[];
}): Map<string, number> {
  const counts = new Map<string, number>();
  for (const queue of queues) {
    for (const group of queue.groups) {
      const separator = group.groupId.indexOf("/");
      if (separator <= 0 || group.pendingJobs <= 0) continue;

      const tenantId = group.groupId.slice(0, separator);
      counts.set(tenantId, (counts.get(tenantId) ?? 0) + group.pendingJobs);
    }
  }

  return counts;
}
