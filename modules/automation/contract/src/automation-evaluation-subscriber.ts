import { z } from "zod";

export const automationEvaluationSubscriberEventSchema = z.object({ occurredAt: z.number() });

export type AutomationEvaluationSubscriberEvent = z.infer<
  typeof automationEvaluationSubscriberEventSchema
>;

export const automationEvaluationSubscriberStateSchema = z.object({
  status: z.string(),
  traceId: z.string().nullable().optional(),
});

export type AutomationEvaluationSubscriberState = z.infer<
  typeof automationEvaluationSubscriberStateSchema
>;

export const automationEvaluationSubscriberContextSchema = z.object({
  tenantId: z.string(),
  state: automationEvaluationSubscriberStateSchema,
});

export type AutomationEvaluationSubscriberContext = z.infer<
  typeof automationEvaluationSubscriberContextSchema
>;

export const automationEvaluationActivityContextSchema = z.object({ tenantId: z.string() });

export type AutomationEvaluationActivityContext = z.infer<
  typeof automationEvaluationActivityContextSchema
>;

export const automationTraceSubscriberContextSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string().optional(),
});

export type AutomationTraceSubscriberContext = z.infer<
  typeof automationTraceSubscriberContextSchema
>;
