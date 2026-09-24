import type { GroupInfo, QueueInfo } from "@langwatch/ops-contract";

/** One scanned group holding `pendingJobs`, every other field at rest. */
export function scannedGroup({
  groupId,
  pendingJobs,
}: {
  groupId: string;
  pendingJobs: number;
}): GroupInfo {
  return {
    groupId,
    pendingJobs,
    score: 0,
    hasActiveJob: false,
    activeJobId: null,
    isBlocked: false,
    oldestJobMs: null,
    newestJobMs: null,
    isStaleBlock: false,
    pipelineName: null,
    jobType: null,
    jobName: null,
    errorMessage: null,
    errorStack: null,
    errorTimestamp: null,
    retryCount: null,
    activeKeyTtlSec: null,
    processingDurationMs: null,
  };
}

/** One queue as the writer's scan returns it. */
export function scannedQueue({ name, groups }: { name: string; groups: GroupInfo[] }): QueueInfo {
  return {
    name,
    displayName: name,
    pendingGroupCount: groups.length,
    blockedGroupCount: 0,
    activeGroupCount: 0,
    totalPendingJobs: groups.reduce((total, group) => total + group.pendingJobs, 0),
    dlqCount: 0,
    parkedGroupCount: 0,
    groups,
  };
}
