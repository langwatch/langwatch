import { z } from "zod";

export const performanceMonitorSchema = z.object({
  id: z.string(),
  isGuardrail: z.boolean(),
});
export type PerformanceMonitor = z.infer<typeof performanceMonitorSchema>;

export const monitorPerformanceQuerySchema = z.object({
  tenantId: z.string(),
  monitors: z.array(performanceMonitorSchema),
  previousStartMs: z.number().int(),
  currentStartMs: z.number().int(),
  endMs: z.number().int(),
  timeZone: z.string(),
});
export type MonitorPerformanceQuery = z.infer<typeof monitorPerformanceQuerySchema>;

export const onlineEvaluationPerformanceSchema = z.object({
  monitorId: z.string(),
  metric: z.enum(["score", "pass_rate"]),
  points: z.array(z.number()),
  current: z.number().nullable(),
  previous: z.number().nullable(),
});
export type OnlineEvaluationPerformance = z.infer<typeof onlineEvaluationPerformanceSchema>;

/** The seven-day trend of a project's monitors, in the reader's own time zone. */
export const monitorPerformanceForProjectInputSchema = z.object({
  projectId: z.string(),
  timeZone: z.string().min(1).max(100).optional(),
});
export type MonitorPerformanceForProjectInput = z.infer<
  typeof monitorPerformanceForProjectInputSchema
>;
