import type { Named } from "@langwatch/module";
import { z } from "zod";

const performanceMonitorSchemaDefinition = z.object({
  id: z.string(),
  isGuardrail: z.boolean(),
});
export interface PerformanceMonitorSchema extends Named<
  typeof performanceMonitorSchemaDefinition
> {}
export const performanceMonitorSchema: PerformanceMonitorSchema =
  performanceMonitorSchemaDefinition;
export type PerformanceMonitor = z.infer<typeof performanceMonitorSchema>;

const monitorPerformanceQuerySchemaDefinition = z.object({
  tenantId: z.string(),
  monitors: z.array(performanceMonitorSchema),
  previousStartMs: z.number().int(),
  currentStartMs: z.number().int(),
  endMs: z.number().int(),
  timeZone: z.string(),
});
export interface MonitorPerformanceQuerySchema extends Named<
  typeof monitorPerformanceQuerySchemaDefinition
> {}
export const monitorPerformanceQuerySchema: MonitorPerformanceQuerySchema =
  monitorPerformanceQuerySchemaDefinition;
export type MonitorPerformanceQuery = z.infer<typeof monitorPerformanceQuerySchema>;

const onlineEvaluationPerformanceSchemaDefinition = z.object({
  monitorId: z.string(),
  metric: z.enum(["score", "pass_rate"]),
  points: z.array(z.number()),
  current: z.number().nullable(),
  previous: z.number().nullable(),
});
export interface OnlineEvaluationPerformanceSchema extends Named<
  typeof onlineEvaluationPerformanceSchemaDefinition
> {}
export const onlineEvaluationPerformanceSchema: OnlineEvaluationPerformanceSchema =
  onlineEvaluationPerformanceSchemaDefinition;
export type OnlineEvaluationPerformance = z.infer<typeof onlineEvaluationPerformanceSchema>;

/** The seven-day trend of a project's monitors, in the reader's own time zone. */
const monitorPerformanceForProjectInputSchemaDefinition = z.object({
  projectId: z.string(),
  timeZone: z.string().min(1).max(100).optional(),
});
export interface MonitorPerformanceForProjectInputSchema extends Named<
  typeof monitorPerformanceForProjectInputSchemaDefinition
> {}
export const monitorPerformanceForProjectInputSchema: MonitorPerformanceForProjectInputSchema =
  monitorPerformanceForProjectInputSchemaDefinition;
export type MonitorPerformanceForProjectInput = z.infer<
  typeof monitorPerformanceForProjectInputSchema
>;
