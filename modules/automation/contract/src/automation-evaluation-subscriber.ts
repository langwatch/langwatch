import type { Named } from "@langwatch/module";
import { z } from "zod";

const automationEvaluationSubscriberEventSchemaDefinition = z.object({
  occurredAt: z.number(),
  // Processing time; the stale guard reads it, since occurredAt may be the evaluated span's end
  createdAt: z.number().optional(),
});
export interface AutomationEvaluationSubscriberEventSchema extends Named<
  typeof automationEvaluationSubscriberEventSchemaDefinition
> {}
export const automationEvaluationSubscriberEventSchema: AutomationEvaluationSubscriberEventSchema =
  automationEvaluationSubscriberEventSchemaDefinition;

export type AutomationEvaluationSubscriberEvent = z.infer<
  typeof automationEvaluationSubscriberEventSchema
>;

const automationEvaluationSubscriberStateSchemaDefinition = z.object({
  status: z.string(),
  traceId: z.string().nullable().optional(),
});
export interface AutomationEvaluationSubscriberStateSchema extends Named<
  typeof automationEvaluationSubscriberStateSchemaDefinition
> {}
export const automationEvaluationSubscriberStateSchema: AutomationEvaluationSubscriberStateSchema =
  automationEvaluationSubscriberStateSchemaDefinition;

export type AutomationEvaluationSubscriberState = z.infer<
  typeof automationEvaluationSubscriberStateSchema
>;

const automationEvaluationSubscriberContextSchemaDefinition = z.object({
  tenantId: z.string(),
  state: automationEvaluationSubscriberStateSchema,
});
export interface AutomationEvaluationSubscriberContextSchema extends Named<
  typeof automationEvaluationSubscriberContextSchemaDefinition
> {}
export const automationEvaluationSubscriberContextSchema: AutomationEvaluationSubscriberContextSchema =
  automationEvaluationSubscriberContextSchemaDefinition;

export type AutomationEvaluationSubscriberContext = z.infer<
  typeof automationEvaluationSubscriberContextSchema
>;

const automationEvaluationActivityContextSchemaDefinition = z.object({ tenantId: z.string() });
export interface AutomationEvaluationActivityContextSchema extends Named<
  typeof automationEvaluationActivityContextSchemaDefinition
> {}
export const automationEvaluationActivityContextSchema: AutomationEvaluationActivityContextSchema =
  automationEvaluationActivityContextSchemaDefinition;

export type AutomationEvaluationActivityContext = z.infer<
  typeof automationEvaluationActivityContextSchema
>;

const automationTraceSubscriberContextSchemaDefinition = z.object({
  tenantId: z.string(),
  aggregateId: z.string().optional(),
});
export interface AutomationTraceSubscriberContextSchema extends Named<
  typeof automationTraceSubscriberContextSchemaDefinition
> {}
export const automationTraceSubscriberContextSchema: AutomationTraceSubscriberContextSchema =
  automationTraceSubscriberContextSchemaDefinition;

export type AutomationTraceSubscriberContext = z.infer<
  typeof automationTraceSubscriberContextSchema
>;

/** Locked ADR-034 Phase 5 real-time debounce for graph-alert sweeps. */
export const GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS = 5_000;

/** One queue lane per tenant, shared by every pipeline that wakes a graph-alert sweep. */
export function graphTriggerActivityGroupKey(event: { tenantId: string }): string {
  return `graph-trigger-activity:${event.tenantId}`;
}
