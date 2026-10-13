import type { Named } from "@langwatch/module";
import { z } from "zod";

export const spendSortFieldSchema = z.enum(["spend", "requests", "lastActivity"]);
export type SpendSortField = z.infer<typeof spendSortFieldSchema>;

export const governanceSortDirectionSchema = z.enum(["asc", "desc"]);
export type GovernanceSortDirection = z.infer<typeof governanceSortDirectionSchema>;

export const spendOverTimeGroupBySchema = z.enum(["team", "user", "model"]);
export type SpendOverTimeGroupBy = z.infer<typeof spendOverTimeGroupBySchema>;

const activityMonitorWindowQuerySchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    windowDays: z.number().int().positive(),
  })
  .strict();
export interface ActivityMonitorWindowQuerySchema extends Named<
  typeof activityMonitorWindowQuerySchemaDefinition
> {}
export const activityMonitorWindowQuerySchema: ActivityMonitorWindowQuerySchema =
  activityMonitorWindowQuerySchemaDefinition;
export type ActivityMonitorWindowQuery = z.infer<typeof activityMonitorWindowQuerySchema>;

const activityMonitorPagedWindowQuerySchemaDefinition = activityMonitorWindowQuerySchema.safeExtend(
  {
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    sortBy: spendSortFieldSchema.optional(),
    sortDir: governanceSortDirectionSchema.optional(),
  },
);
export interface ActivityMonitorPagedWindowQuerySchema extends Named<
  typeof activityMonitorPagedWindowQuerySchemaDefinition
> {}
export const activityMonitorPagedWindowQuerySchema: ActivityMonitorPagedWindowQuerySchema =
  activityMonitorPagedWindowQuerySchemaDefinition;
export type ActivityMonitorPagedWindowQuery = z.infer<typeof activityMonitorPagedWindowQuerySchema>;

const activityMonitorSummarySchemaDefinition = z
  .object({
    spentThisWindowUsd: z.number(),
    windowOverPreviousPct: z.number(),
    hasPriorBaseline: z.boolean(),
    activeUsersThisWindow: z.number().int().nonnegative(),
    newUsersThisWindow: z.number().int().nonnegative(),
    openAnomalyCount: z.number().int().nonnegative(),
    anomalyBreakdown: z
      .object({
        critical: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        info: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export interface ActivityMonitorSummarySchema extends Named<
  typeof activityMonitorSummarySchemaDefinition
> {}
export const activityMonitorSummarySchema: ActivityMonitorSummarySchema =
  activityMonitorSummarySchemaDefinition;
export type ActivityMonitorSummary = z.infer<typeof activityMonitorSummarySchema>;

const spendByUserRowSchemaDefinition = z
  .object({
    actor: z.string(),
    spendUsd: z.string(),
    requests: z.number().int().nonnegative(),
    lastActivityIso: z.string(),
    trendVsPreviousPct: z.number(),
    hasPriorBaseline: z.boolean(),
    mostUsedTarget: z.string().nullable(),
  })
  .strict();
export interface SpendByUserRowSchema extends Named<typeof spendByUserRowSchemaDefinition> {}
export const spendByUserRowSchema: SpendByUserRowSchema = spendByUserRowSchemaDefinition;
export type SpendByUserRow = z.infer<typeof spendByUserRowSchema>;

const spendByTeamRowSchemaDefinition = z
  .object({
    teamId: z.string().nullable(),
    teamName: z.string(),
    spendUsd: z.string(),
    requestCount: z.number().int().nonnegative(),
    deltaPctVsPriorWindow: z.number(),
    hasPriorBaseline: z.boolean(),
    lastActivityIso: z.string().nullable(),
    sourceCount: z.number().int().nonnegative(),
  })
  .strict();
export interface SpendByTeamRowSchema extends Named<typeof spendByTeamRowSchemaDefinition> {}
export const spendByTeamRowSchema: SpendByTeamRowSchema = spendByTeamRowSchemaDefinition;
export type SpendByTeamRow = z.infer<typeof spendByTeamRowSchema>;

const spendByDepartmentRowSchemaDefinition = z
  .object({
    departmentId: z.string().nullable(),
    departmentName: z.string(),
    spendUsd: z.string(),
    requestCount: z.number().int().nonnegative(),
    lastActivityIso: z.string().nullable(),
  })
  .strict();
export interface SpendByDepartmentRowSchema extends Named<
  typeof spendByDepartmentRowSchemaDefinition
> {}
export const spendByDepartmentRowSchema: SpendByDepartmentRowSchema =
  spendByDepartmentRowSchemaDefinition;
export type SpendByDepartmentRow = z.infer<typeof spendByDepartmentRowSchema>;

const ingestionSourceHealthRowSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceType: z.string(),
    status: z.string(),
    lastEventIso: z.string().nullable(),
    eventsLast24h: z.number().int().nonnegative(),
  })
  .strict();
export interface IngestionSourceHealthRowSchema extends Named<
  typeof ingestionSourceHealthRowSchemaDefinition
> {}
export const ingestionSourceHealthRowSchema: IngestionSourceHealthRowSchema =
  ingestionSourceHealthRowSchemaDefinition;
export type IngestionSourceHealthRow = z.infer<typeof ingestionSourceHealthRowSchema>;

const spendOverTimeBucketSchemaDefinition = z
  .object({
    bucketIso: z.string(),
    points: z.array(
      z.object({ key: z.string(), label: z.string(), spendUsd: z.string() }).strict(),
    ),
  })
  .strict();
export interface SpendOverTimeBucketSchema extends Named<
  typeof spendOverTimeBucketSchemaDefinition
> {}
export const spendOverTimeBucketSchema: SpendOverTimeBucketSchema =
  spendOverTimeBucketSchemaDefinition;
export type SpendOverTimeBucket = z.infer<typeof spendOverTimeBucketSchema>;
const spendOverTimeResultSchemaDefinition = z
  .object({ buckets: z.array(spendOverTimeBucketSchema) })
  .strict();
export interface SpendOverTimeResultSchema extends Named<
  typeof spendOverTimeResultSchemaDefinition
> {}
export const spendOverTimeResultSchema: SpendOverTimeResultSchema =
  spendOverTimeResultSchemaDefinition;
export type SpendOverTimeResult = z.infer<typeof spendOverTimeResultSchema>;

const activityEventDetailRowSchemaDefinition = z
  .object({
    eventId: z.string(),
    eventType: z.string(),
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    costUsd: z.string(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    eventTimestampIso: z.string(),
    ingestedAtIso: z.string(),
    rawPayload: z.string(),
  })
  .strict();
export interface ActivityEventDetailRowSchema extends Named<
  typeof activityEventDetailRowSchemaDefinition
> {}
export const activityEventDetailRowSchema: ActivityEventDetailRowSchema =
  activityEventDetailRowSchemaDefinition;
export type ActivityEventDetailRow = z.infer<typeof activityEventDetailRowSchema>;

const recentAnomalyRowSchemaDefinition = z
  .object({
    id: z.string(),
    ruleId: z.string(),
    ruleName: z.string(),
    ruleType: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
    triggerWindowStartIso: z.string(),
    triggerWindowEndIso: z.string(),
    triggerSpendUsd: z.number().nullable(),
    triggerEventCount: z.number().int().nullable(),
    detectedAtIso: z.string(),
    state: z.string(),
    currentState: z.enum(["open", "acknowledged", "resolved"]),
    detail: z.record(z.string(), z.unknown()),
    rule: z.string(),
    sourceLabel: z.string(),
  })
  .strict();
export interface RecentAnomalyRowSchema extends Named<typeof recentAnomalyRowSchemaDefinition> {}
export const recentAnomalyRowSchema: RecentAnomalyRowSchema = recentAnomalyRowSchemaDefinition;
export type RecentAnomalyRow = z.infer<typeof recentAnomalyRowSchema>;

const sourceHealthMetricsSchemaDefinition = z
  .object({
    events24h: z.number().int().nonnegative(),
    events7d: z.number().int().nonnegative(),
    events30d: z.number().int().nonnegative(),
    lastSuccessIso: z.string().nullable(),
  })
  .strict();
export interface SourceHealthMetricsSchema extends Named<
  typeof sourceHealthMetricsSchemaDefinition
> {}
export const sourceHealthMetricsSchema: SourceHealthMetricsSchema =
  sourceHealthMetricsSchemaDefinition;
export type SourceHealthMetrics = z.infer<typeof sourceHealthMetricsSchema>;
