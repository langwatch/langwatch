import { z } from "zod";
import {
  errorClusterSchema,
  groupInfoSchema,
  parkedGroupInfoSchema,
  parkedTenantSchema,
} from "./ops-dashboard.ts";

export type {
  ErrorCluster,
  GroupInfo,
  ParkedGroupInfo,
  QueueInfo,
  QueueSummaryInfo,
} from "./ops-dashboard.ts";

/** One page of a group's jobs. */
export const opsQueueJobEnvelopeSchema = z.object({
  format: z.string().nullable(),
  version: z.number().nullable(),
  blobId: z.string().nullable(),
});
export type OpsQueueJobEnvelope = z.infer<typeof opsQueueJobEnvelopeSchema>;

export const opsQueueJobSchema = z.object({
  jobId: z.string(),
  score: z.number(),
  data: z.record(z.string(), z.unknown()).nullable(),
  payloadBytes: z.number().nullable(),
  envelope: opsQueueJobEnvelopeSchema.nullable(),
});
export type OpsQueueJob = z.infer<typeof opsQueueJobSchema>;

export const opsQueueJobsPageSchema = z.object({
  jobs: z.array(opsQueueJobSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type OpsQueueJobsPage = z.infer<typeof opsQueueJobsPageSchema>;

export const opsQueueGroupsPageSchema = z.object({
  groups: z.array(groupInfoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type OpsQueueGroupsPage = z.infer<typeof opsQueueGroupsPageSchema>;

export const opsParkedGroupsPageSchema = z.object({
  groups: z.array(parkedGroupInfoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type OpsParkedGroupsPage = z.infer<typeof opsParkedGroupsPageSchema>;

export const opsParkedTenantsPageSchema = z.object({
  tenants: z.array(parkedTenantSchema),
  total: z.number(),
});
export type OpsParkedTenantsPage = z.infer<typeof opsParkedTenantsPageSchema>;

export const opsBlockedSummarySchema = z.object({
  totalBlocked: z.number(),
  clusters: z.array(errorClusterSchema),
});
export type OpsBlockedSummary = z.infer<typeof opsBlockedSummarySchema>;

export const opsQueueDlqGroupSchema = z.object({
  groupId: z.string(),
  error: z.string().nullable(),
  errorStack: z.string().nullable(),
  pipelineName: z.string().nullable(),
  jobCount: z.number(),
  movedAt: z.number().nullable(),
});
export type OpsQueueDlqGroup = z.infer<typeof opsQueueDlqGroupSchema>;

export const opsQueueDlqGroupWithQueueSchema = opsQueueDlqGroupSchema.extend({
  queueName: z.string(),
  queueDisplayName: z.string(),
});
export type OpsQueueDlqGroupWithQueue = z.infer<typeof opsQueueDlqGroupWithQueueSchema>;

export const opsQueueDrainPreviewSchema = z.object({
  totalAffected: z.number(),
  byPipeline: z.array(z.object({ name: z.string(), count: z.number() })),
  byError: z.array(z.object({ message: z.string(), count: z.number() })),
});
export type OpsQueueDrainPreview = z.infer<typeof opsQueueDrainPreviewSchema>;

export const opsQueueReconcileResultSchema = z.object({
  counter: z.number(),
  groundTruth: z.number(),
  drift: z.number(),
});
export type OpsQueueReconcileResult = z.infer<typeof opsQueueReconcileResultSchema>;

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
