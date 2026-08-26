import type {
  ErrorCluster,
  GroupInfo,
  ParkedGroupInfo,
  QueueInfo,
  QueueSummaryInfo,
} from "./ops-dashboard";
import type { ParkedTenant } from "./ops-snapshot";

export interface OpsQueueJobsPage {
  jobs: OpsQueueJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpsQueueGroupsPage {
  groups: GroupInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpsParkedGroupsPage {
  groups: ParkedGroupInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpsParkedTenantsPage {
  tenants: ParkedTenant[];
  total: number;
}

export interface OpsBlockedSummary {
  totalBlocked: number;
  clusters: ErrorCluster[];
}

export interface OpsQueueDlqGroup {
  groupId: string;
  error: string | null;
  errorStack: string | null;
  pipelineName: string | null;
  jobCount: number;
  movedAt: number | null;
}

export interface OpsQueueDrainPreview {
  totalAffected: number;
  byPipeline: Array<{ name: string; count: number }>;
  byError: Array<{ message: string; count: number }>;
}

export interface OpsQueueJobEnvelope {
  format: string | null;
  version: number | null;
  blobId: string | null;
}

export interface OpsQueueJob {
  jobId: string;
  score: number;
  data: Record<string, unknown> | null;
  payloadBytes: number | null;
  envelope: OpsQueueJobEnvelope | null;
}

export interface OpsQueueReconcileResult {
  counter: number;
  groundTruth: number;
  drift: number;
}

export interface OpsQueueDlqGroupWithQueue extends OpsQueueDlqGroup {
  queueName: string;
  queueDisplayName: string;
}

export type { ErrorCluster, GroupInfo, ParkedGroupInfo, QueueInfo, QueueSummaryInfo };
