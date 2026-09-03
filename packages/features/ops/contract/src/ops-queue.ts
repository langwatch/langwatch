import { z } from "zod";
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

/**
 * The input shapes the operator queue surface parses.
 *
 * These are transport contracts rather than service ones: they carry the page
 * sizes and ceilings a caller is held to, which is why the paging fields are
 * defaulted here and merely optional on the service inputs above.
 */
export const opsQueueNameInputSchema = z.object({ queueName: z.string() });

export const opsQueueGroupInputSchema = z.object({
  queueName: z.string(),
  groupId: z.string(),
});

export const opsQueueFilterInputSchema = z.object({
  queueName: z.string(),
  pipelineFilter: z.string().optional(),
  errorFilter: z.string().optional(),
});

export const opsQueueCanaryInputSchema = z.object({
  queueName: z.string(),
  count: z.number().int().min(1).max(100).default(5),
  pipelineFilter: z.string().optional(),
});

export const opsQueueTenantInputSchema = z.object({
  queueName: z.string(),
  tenantId: z.string().min(1),
});

export const opsQueueGroupIdsInputSchema = z.object({
  queueName: z.string(),
  groupIds: z.array(z.string().min(1).max(500)).min(1).max(2000),
});

export const opsListParkedQueueGroupsInputSchema = z.object({
  queueName: z.string(),
  tenantId: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const opsListQueueGroupsInputSchema = z.object({
  queueName: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const opsListQueueGroupJobsInputSchema = z.object({
  queueName: z.string(),
  groupId: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/** Pause and resume address one pipeline key inside a queue. */
export const opsQueuePipelineInputSchema = z.object({
  queueName: z.string(),
  key: z.string(),
});

export const opsDrainQueueTenantInputSchema = z.object({
  queueName: z.string(),
  tenantId: z.string().min(1),
  // Optional substring filter on groupId. Honest substring semantics —
  // see drainTenant repo doc for example fragments to type.
  groupIdContains: z.string().optional(),
});

export const opsRetryBlockedQueueJobInputSchema = z.object({
  queueName: z.string(),
  groupId: z.string(),
  jobId: z.string(),
});
