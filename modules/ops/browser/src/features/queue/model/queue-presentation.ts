/** Browser-safe queue shapes consumed by Ops presentation components. */
export interface OpsPipelineNode {
  name: string;
  pending: number;
  active: number;
  blocked: number;
  children: OpsPipelineNode[];
}

/** The group fields needed for status, ordering, and recovery presentation. */
export interface OpsQueueGroup {
  groupId: string;
  pendingJobs: number;
  score: number;
  hasActiveJob: boolean;
  activeJobId: string | null;
  isBlocked: boolean;
  oldestJobMs: number | null;
  newestJobMs: number | null;
  isStaleBlock: boolean;
  pipelineName: string | null;
  jobType: string | null;
  jobName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  errorTimestamp: number | null;
  retryCount: number | null;
  activeKeyTtlSec: number | null;
  processingDurationMs: number | null;
}
