import { z } from "zod";

export const spendSortFieldSchema = z.enum(["spend", "requests", "lastActivity"]);
export type SpendSortField = z.infer<typeof spendSortFieldSchema>;

export const governanceSortDirectionSchema = z.enum(["asc", "desc"]);
export type GovernanceSortDirection = z.infer<typeof governanceSortDirectionSchema>;

export const spendOverTimeGroupBySchema = z.enum(["team", "user", "model"]);
export type SpendOverTimeGroupBy = z.infer<typeof spendOverTimeGroupBySchema>;

export const activityMonitorWindowQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    windowDays: z.number().int().positive(),
  })
  .strict();
export type ActivityMonitorWindowQuery = z.infer<typeof activityMonitorWindowQuerySchema>;

export const activityMonitorPagedWindowQuerySchema =
  activityMonitorWindowQuerySchema.extend({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    sortBy: spendSortFieldSchema.optional(),
    sortDir: governanceSortDirectionSchema.optional(),
  });
export type ActivityMonitorPagedWindowQuery = z.infer<
  typeof activityMonitorPagedWindowQuerySchema
>;

export const activityMonitorSummarySchema = z
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
export type ActivityMonitorSummary = z.infer<typeof activityMonitorSummarySchema>;

export const spendByUserRowSchema = z
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
export type SpendByUserRow = z.infer<typeof spendByUserRowSchema>;

export const spendByTeamRowSchema = z
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
export type SpendByTeamRow = z.infer<typeof spendByTeamRowSchema>;

export const spendByDepartmentRowSchema = z
  .object({
    departmentId: z.string().nullable(),
    departmentName: z.string(),
    spendUsd: z.string(),
    requestCount: z.number().int().nonnegative(),
    lastActivityIso: z.string().nullable(),
  })
  .strict();
export type SpendByDepartmentRow = z.infer<typeof spendByDepartmentRowSchema>;

export const ingestionSourceHealthRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceType: z.string(),
    status: z.string(),
    lastEventIso: z.string().nullable(),
    eventsLast24h: z.number().int().nonnegative(),
  })
  .strict();
export type IngestionSourceHealthRow = z.infer<typeof ingestionSourceHealthRowSchema>;

export const spendOverTimeBucketSchema = z
  .object({
    bucketIso: z.string(),
    points: z.array(
      z.object({ key: z.string(), label: z.string(), spendUsd: z.string() }).strict(),
    ),
  })
  .strict();
export type SpendOverTimeBucket = z.infer<typeof spendOverTimeBucketSchema>;
export const spendOverTimeResultSchema = z
  .object({ buckets: z.array(spendOverTimeBucketSchema) })
  .strict();
export type SpendOverTimeResult = z.infer<typeof spendOverTimeResultSchema>;

export const activityEventDetailRowSchema = z
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
export type ActivityEventDetailRow = z.infer<typeof activityEventDetailRowSchema>;

export const recentAnomalyRowSchema = z
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
export type RecentAnomalyRow = z.infer<typeof recentAnomalyRowSchema>;

export const sourceHealthMetricsSchema = z
  .object({
    events24h: z.number().int().nonnegative(),
    events7d: z.number().int().nonnegative(),
    events30d: z.number().int().nonnegative(),
    lastSuccessIso: z.string().nullable(),
  })
  .strict();
export type SourceHealthMetrics = z.infer<typeof sourceHealthMetricsSchema>;
