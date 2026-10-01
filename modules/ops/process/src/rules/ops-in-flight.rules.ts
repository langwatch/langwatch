/** Includes parked groups in in-flight counts; must include every state staged work can sit in. */

export type InFlightCounts = {
  totalPendingJobs: number;
  activeGroupCount: number;
  parkedGroupCount: number;
};

export function totalInFlight({ queues }: { queues: readonly InFlightCounts[] }): number {
  let total = 0;
  for (const queue of queues) {
    total += queue.totalPendingJobs + queue.activeGroupCount + queue.parkedGroupCount;
  }
  return total;
}
