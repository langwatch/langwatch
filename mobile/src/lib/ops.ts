/**
 * Ops judgement calls that are pure functions: how to order a list, when a
 * figure counts as trouble, and what a sweep outcome means.
 *
 * They live apart from the screens so they can be tested without rendering
 * anything, and so the same rule is applied everywhere it matters rather than
 * re-derived per screen.
 */

export type Severity = "normal" | "warning" | "critical";

/** Anything an operator would want to look at first. */
export function queueNeedsAttention(queue: {
  blockedGroupCount: number;
  dlqCount: number;
}): boolean {
  return queue.blockedGroupCount > 0 || queue.dlqCount > 0;
}

/**
 * Queues ranked by trouble, not by name: a queue with blocked groups goes above
 * a healthy one with a bigger backlog, because a backlog drains on its own and
 * a block does not.
 */
export function orderQueues<
  T extends {
    blockedGroupCount: number;
    dlqCount: number;
    totalPendingJobs: number;
  },
>(queues: readonly T[]): T[] {
  return [...queues].sort((left, right) => {
    const leftTrouble = queueNeedsAttention(left);
    const rightTrouble = queueNeedsAttention(right);
    if (leftTrouble !== rightTrouble) return leftTrouble ? -1 : 1;
    if (left.blockedGroupCount !== right.blockedGroupCount) {
      return right.blockedGroupCount - left.blockedGroupCount;
    }
    if (left.dlqCount !== right.dlqCount) return right.dlqCount - left.dlqCount;
    return right.totalPendingJobs - left.totalPendingJobs;
  });
}

/** Blocked groups first, then the deepest backlog. */
export function orderGroups<T extends { isBlocked: boolean; pendingJobs: number }>(
  groups: readonly T[],
): T[] {
  return [...groups].sort((left, right) => {
    if (left.isBlocked !== right.isBlocked) return left.isBlocked ? -1 : 1;
    return right.pendingJobs - left.pendingJobs;
  });
}

/**
 * A schedule that has failed and is retrying — what an operator is scanning the
 * scheduler list for.
 */
export function scheduleIsStruggling(job: {
  attempts: number;
  lastError: string | null;
}): boolean {
  return job.attempts > 0 && job.lastError !== null;
}

export function orderSchedules<
  T extends { attempts: number; lastError: string | null; active: boolean; nextRunAt: string },
>(jobs: readonly T[]): T[] {
  return [...jobs].sort((left, right) => {
    const leftStuck = scheduleIsStruggling(left);
    const rightStuck = scheduleIsStruggling(right);
    if (leftStuck !== rightStuck) return leftStuck ? -1 : 1;
    if (left.active !== right.active) return left.active ? -1 : 1;
    // ISO-8601 in UTC sorts lexicographically, which is what the server sends.
    return left.nextRunAt.localeCompare(right.nextRunAt);
  });
}

/**
 * How many times over baseline. Null when there is no baseline to divide by,
 * which is a real state on a tenant that had no traffic at all before — and
 * dividing anyway would put "Infinity" on the screen.
 */
export function multipleOfBaseline(anomaly: {
  currentRate: number;
  baseline: number;
}): number | null {
  return anomaly.baseline > 0 ? anomaly.currentRate / anomaly.baseline : null;
}

export function redisMemorySeverity(snapshot: {
  redisMemoryUsedBytes: number;
  redisMemoryMaxBytes: number;
}): Severity {
  if (snapshot.redisMemoryMaxBytes <= 0) return "normal";
  const ratio = snapshot.redisMemoryUsedBytes / snapshot.redisMemoryMaxBytes;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.75) return "warning";
  return "normal";
}

export function sweepOutcomeSeverity(outcome: string): Severity {
  switch (outcome) {
    case "reclaimed":
      return "critical";
    case "repaired":
    case "bookkeeping":
      return "warning";
    default:
      return "normal";
  }
}

export function explainSweepOutcome(outcome: string): string {
  switch (outcome) {
    case "leased":
      return "A live lease still references it. A sweep leaves it alone.";
    case "repaired":
      return "Unleased and holding longer than the grace window. A sweep shortens its expiry — it never destroys bytes.";
    case "reclaimed":
      return "Unleased and past the safety margin. A real sweep deletes the bytes.";
    case "bookkeeping":
      return "The bytes are already gone. A sweep only drops the stale lease and holder keys.";
    case "pending":
      return "Unleased and already counting down inside the margin. A sweep leaves it to expire.";
    default:
      return "This instance reported an outcome this app does not recognise.";
  }
}

/**
 * The confirmation word a real sweep requires. The server checks the same
 * literal, so a client that skipped this step would still be refused — the
 * typing is here to make the act deliberate, not to be the security boundary.
 */
export const SWEEP_CONFIRMATION = "RECLAIM";

/**
 * Exactly: no trimming, no case folding. Half the value of a typed confirmation
 * is that it cannot be produced by a thumb brushing the screen, and a forgiving
 * comparison gives that away.
 */
export function isSweepConfirmed(typed: string): boolean {
  return typed === SWEEP_CONFIRMATION;
}

export const BLOB_SORTS = [
  "largest",
  "stalest",
  "unreferenced",
  "oldest_lapsed_lease",
  "scan",
] as const;

export type BlobSort = (typeof BLOB_SORTS)[number];

export function blobSortLabel(sort: BlobSort): string {
  switch (sort) {
    case "largest":
      return "Largest";
    case "stalest":
      return "Stalest";
    case "unreferenced":
      return "Unreferenced";
    case "oldest_lapsed_lease":
      return "Lapsed lease";
    case "scan":
      return "Everything";
  }
}

export function blobSortExplanation(sort: BlobSort): string {
  switch (sort) {
    case "largest":
      return "Biggest payloads first — what is actually occupying the instance.";
    case "stalest":
      return "Least recently touched first. Every access re-arms the expiry, so a low remaining time means nothing has read this in a while.";
    case "unreferenced":
      return "Nothing holds a live lease. This is the reclaimable set.";
    case "oldest_lapsed_lease":
      return "Longest-lapsed lease first — where a holder most likely died mid-flight.";
    case "scan":
      return "Storage order. The only complete walk; no ranking.";
  }
}
