/**
 * What counts as work IN FLIGHT for the dashboard's throughput arithmetic.
 *
 * The ingestion rate is not measured, it is derived: staged ≈ the change in
 * in-flight work plus what completed and failed over the same window. That
 * identity only holds if every state staged work can be sitting in is on the
 * in-flight side of it.
 *
 * Parked groups are the case that broke it. A parked group is staged,
 * unfinished, and returns on its own once its tenant drops back under its
 * in-flight cap — nothing about it is terminal. Leaving it out made every
 * group that parked read as work LEAVING the system, so `Staged/s`
 * under-reported real staging by exactly the parking rate, and the books
 * balanced only while nothing was parking, which is the one time nobody is
 * reading the number.
 *
 * @see specs/ops/shared-ops-snapshot.feature
 */

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
