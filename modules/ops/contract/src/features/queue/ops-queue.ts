import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  errorClusterSchema,
  groupInfoSchema,
  parkedGroupInfoSchema,
  parkedTenantSchema,
} from "../dashboard/ops-dashboard.ts";

/** One page of a group's jobs. */
const opsQueueJobEnvelopeSchemaDefinition = z.object({
  format: z.string().nullable(),
  version: z.number().nullable(),
  blobId: z.string().nullable(),
});
export interface OpsQueueJobEnvelopeSchema extends Named<
  typeof opsQueueJobEnvelopeSchemaDefinition
> {}
export const opsQueueJobEnvelopeSchema: OpsQueueJobEnvelopeSchema =
  opsQueueJobEnvelopeSchemaDefinition;
export type OpsQueueJobEnvelope = z.infer<typeof opsQueueJobEnvelopeSchema>;

const opsQueueJobSchemaDefinition = z.object({
  jobId: z.string(),
  score: z.number(),
  data: z.record(z.string(), z.unknown()).nullable(),
  payloadBytes: z.number().nullable(),
  envelope: opsQueueJobEnvelopeSchema.nullable(),
});
export interface OpsQueueJobSchema extends Named<typeof opsQueueJobSchemaDefinition> {}
export const opsQueueJobSchema: OpsQueueJobSchema = opsQueueJobSchemaDefinition;
export type OpsQueueJob = z.infer<typeof opsQueueJobSchema>;

const opsQueueJobsPageSchemaDefinition = z.object({
  jobs: z.array(opsQueueJobSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export interface OpsQueueJobsPageSchema extends Named<typeof opsQueueJobsPageSchemaDefinition> {}
export const opsQueueJobsPageSchema: OpsQueueJobsPageSchema = opsQueueJobsPageSchemaDefinition;
export type OpsQueueJobsPage = z.infer<typeof opsQueueJobsPageSchema>;

const opsQueueGroupsPageSchemaDefinition = z.object({
  groups: z.array(groupInfoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export interface OpsQueueGroupsPageSchema extends Named<
  typeof opsQueueGroupsPageSchemaDefinition
> {}
export const opsQueueGroupsPageSchema: OpsQueueGroupsPageSchema =
  opsQueueGroupsPageSchemaDefinition;
export type OpsQueueGroupsPage = z.infer<typeof opsQueueGroupsPageSchema>;

const opsParkedGroupsPageSchemaDefinition = z.object({
  groups: z.array(parkedGroupInfoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export interface OpsParkedGroupsPageSchema extends Named<
  typeof opsParkedGroupsPageSchemaDefinition
> {}
export const opsParkedGroupsPageSchema: OpsParkedGroupsPageSchema =
  opsParkedGroupsPageSchemaDefinition;
export type OpsParkedGroupsPage = z.infer<typeof opsParkedGroupsPageSchema>;

const opsParkedTenantsPageSchemaDefinition = z.object({
  tenants: z.array(parkedTenantSchema),
  total: z.number(),
});
export interface OpsParkedTenantsPageSchema extends Named<
  typeof opsParkedTenantsPageSchemaDefinition
> {}
export const opsParkedTenantsPageSchema: OpsParkedTenantsPageSchema =
  opsParkedTenantsPageSchemaDefinition;
export type OpsParkedTenantsPage = z.infer<typeof opsParkedTenantsPageSchema>;

const opsBlockedSummarySchemaDefinition = z.object({
  totalBlocked: z.number(),
  clusters: z.array(errorClusterSchema),
});
export interface OpsBlockedSummarySchema extends Named<typeof opsBlockedSummarySchemaDefinition> {}
export const opsBlockedSummarySchema: OpsBlockedSummarySchema = opsBlockedSummarySchemaDefinition;
export type OpsBlockedSummary = z.infer<typeof opsBlockedSummarySchema>;

const opsQueueDlqGroupSchemaDefinition = z.object({
  groupId: z.string(),
  error: z.string().nullable(),
  errorStack: z.string().nullable(),
  pipelineName: z.string().nullable(),
  jobCount: z.number(),
  movedAt: z.number().nullable(),
});
export interface OpsQueueDlqGroupSchema extends Named<typeof opsQueueDlqGroupSchemaDefinition> {}
export const opsQueueDlqGroupSchema: OpsQueueDlqGroupSchema = opsQueueDlqGroupSchemaDefinition;
export type OpsQueueDlqGroup = z.infer<typeof opsQueueDlqGroupSchema>;

const opsQueueDlqGroupWithQueueSchemaDefinition = z.object({
  ...opsQueueDlqGroupSchema.shape,
  queueName: z.string(),
  queueDisplayName: z.string(),
});
export interface OpsQueueDlqGroupWithQueueSchema extends Named<
  typeof opsQueueDlqGroupWithQueueSchemaDefinition
> {}
export const opsQueueDlqGroupWithQueueSchema: OpsQueueDlqGroupWithQueueSchema =
  opsQueueDlqGroupWithQueueSchemaDefinition;
export type OpsQueueDlqGroupWithQueue = z.infer<typeof opsQueueDlqGroupWithQueueSchema>;

const opsQueueDrainPreviewSchemaDefinition = z.object({
  totalAffected: z.number(),
  byPipeline: z.array(z.object({ name: z.string(), count: z.number() })),
  byError: z.array(z.object({ message: z.string(), count: z.number() })),
});
export interface OpsQueueDrainPreviewSchema extends Named<
  typeof opsQueueDrainPreviewSchemaDefinition
> {}
export const opsQueueDrainPreviewSchema: OpsQueueDrainPreviewSchema =
  opsQueueDrainPreviewSchemaDefinition;
export type OpsQueueDrainPreview = z.infer<typeof opsQueueDrainPreviewSchema>;

const opsQueueReconcileResultSchemaDefinition = z.object({
  counter: z.number(),
  groundTruth: z.number(),
  drift: z.number(),
});
export interface OpsQueueReconcileResultSchema extends Named<
  typeof opsQueueReconcileResultSchemaDefinition
> {}
export const opsQueueReconcileResultSchema: OpsQueueReconcileResultSchema =
  opsQueueReconcileResultSchemaDefinition;
export type OpsQueueReconcileResult = z.infer<typeof opsQueueReconcileResultSchema>;

/**
 * The input shapes the operator queue surface parses. Transport contracts
 * rather than service ones: they carry the page sizes and ceilings a
 * caller is held to, defaulted here though merely optional on the service.
 */
const opsQueueNameInputSchemaDefinition = z.object({ queueName: z.string() });
export interface OpsQueueNameInputSchema extends Named<typeof opsQueueNameInputSchemaDefinition> {}
export const opsQueueNameInputSchema: OpsQueueNameInputSchema = opsQueueNameInputSchemaDefinition;

const opsQueueGroupInputSchemaDefinition = z.object({
  queueName: z.string(),
  groupId: z.string(),
});
export interface OpsQueueGroupInputSchema extends Named<
  typeof opsQueueGroupInputSchemaDefinition
> {}
export const opsQueueGroupInputSchema: OpsQueueGroupInputSchema =
  opsQueueGroupInputSchemaDefinition;

const opsQueueFilterInputSchemaDefinition = z.object({
  queueName: z.string(),
  pipelineFilter: z.string().optional(),
  errorFilter: z.string().optional(),
});
export interface OpsQueueFilterInputSchema extends Named<
  typeof opsQueueFilterInputSchemaDefinition
> {}
export const opsQueueFilterInputSchema: OpsQueueFilterInputSchema =
  opsQueueFilterInputSchemaDefinition;

const opsQueueCanaryInputSchemaDefinition = z.object({
  queueName: z.string(),
  count: z.number().int().min(1).max(100).default(5),
  pipelineFilter: z.string().optional(),
});
export interface OpsQueueCanaryInputSchema extends Named<
  typeof opsQueueCanaryInputSchemaDefinition
> {}
export const opsQueueCanaryInputSchema: OpsQueueCanaryInputSchema =
  opsQueueCanaryInputSchemaDefinition;

const opsQueueTenantInputSchemaDefinition = z.object({
  queueName: z.string(),
  tenantId: z.string().min(1),
});
export interface OpsQueueTenantInputSchema extends Named<
  typeof opsQueueTenantInputSchemaDefinition
> {}
export const opsQueueTenantInputSchema: OpsQueueTenantInputSchema =
  opsQueueTenantInputSchemaDefinition;

const opsQueueGroupIdsInputSchemaDefinition = z.object({
  queueName: z.string(),
  groupIds: z.array(z.string().min(1).max(500)).min(1).max(2000),
});
export interface OpsQueueGroupIdsInputSchema extends Named<
  typeof opsQueueGroupIdsInputSchemaDefinition
> {}
export const opsQueueGroupIdsInputSchema: OpsQueueGroupIdsInputSchema =
  opsQueueGroupIdsInputSchemaDefinition;

const opsListParkedQueueGroupsInputSchemaDefinition = z.object({
  queueName: z.string(),
  tenantId: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export interface OpsListParkedQueueGroupsInputSchema extends Named<
  typeof opsListParkedQueueGroupsInputSchemaDefinition
> {}
export const opsListParkedQueueGroupsInputSchema: OpsListParkedQueueGroupsInputSchema =
  opsListParkedQueueGroupsInputSchemaDefinition;

const opsListQueueGroupsInputSchemaDefinition = z.object({
  queueName: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export interface OpsListQueueGroupsInputSchema extends Named<
  typeof opsListQueueGroupsInputSchemaDefinition
> {}
export const opsListQueueGroupsInputSchema: OpsListQueueGroupsInputSchema =
  opsListQueueGroupsInputSchemaDefinition;

const opsListQueueGroupJobsInputSchemaDefinition = z.object({
  queueName: z.string(),
  groupId: z.string(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export interface OpsListQueueGroupJobsInputSchema extends Named<
  typeof opsListQueueGroupJobsInputSchemaDefinition
> {}
export const opsListQueueGroupJobsInputSchema: OpsListQueueGroupJobsInputSchema =
  opsListQueueGroupJobsInputSchemaDefinition;

/** Pause and resume address one pipeline key inside a queue. */
const opsQueuePipelineInputSchemaDefinition = z.object({
  queueName: z.string(),
  key: z.string(),
});
export interface OpsQueuePipelineInputSchema extends Named<
  typeof opsQueuePipelineInputSchemaDefinition
> {}
export const opsQueuePipelineInputSchema: OpsQueuePipelineInputSchema =
  opsQueuePipelineInputSchemaDefinition;

const opsDrainQueueTenantInputSchemaDefinition = z.object({
  queueName: z.string(),
  tenantId: z.string().min(1),
  // Optional substring filter on groupId. Honest substring semantics —
  // see drainTenant repo doc for example fragments to type.
  groupIdContains: z.string().optional(),
});
export interface OpsDrainQueueTenantInputSchema extends Named<
  typeof opsDrainQueueTenantInputSchemaDefinition
> {}
export const opsDrainQueueTenantInputSchema: OpsDrainQueueTenantInputSchema =
  opsDrainQueueTenantInputSchemaDefinition;

const opsRetryBlockedQueueJobInputSchemaDefinition = z.object({
  queueName: z.string(),
  groupId: z.string(),
  jobId: z.string(),
});
export interface OpsRetryBlockedQueueJobInputSchema extends Named<
  typeof opsRetryBlockedQueueJobInputSchemaDefinition
> {}
export const opsRetryBlockedQueueJobInputSchema: OpsRetryBlockedQueueJobInputSchema =
  opsRetryBlockedQueueJobInputSchemaDefinition;

export type OpsQueueReconcileOutcome =
  | { kind: "reconciled"; result: OpsQueueReconcileResult }
  | { kind: "skipped" };

/** What one reap of stranded groups found and freed; the per-group list stays in the server log. */
const opsQueueReapedStrandedGroupsSchemaDefinition = z.object({
  strandedGroups: z.number(),
  strandedJobs: z.number(),
  deletedGroups: z.number(),
  failedDeletes: z.number(),
  totalPendingNow: z.number().nullable(),
});
export interface OpsQueueReapedStrandedGroupsSchema extends Named<
  typeof opsQueueReapedStrandedGroupsSchemaDefinition
> {}
export const opsQueueReapedStrandedGroupsSchema: OpsQueueReapedStrandedGroupsSchema =
  opsQueueReapedStrandedGroupsSchemaDefinition;
export type OpsQueueReapedStrandedGroups = z.infer<typeof opsQueueReapedStrandedGroupsSchema>;
