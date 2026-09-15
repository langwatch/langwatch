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

/**
 * Automation's event-subscriber lifecycle for terminal Evaluation events.
 * It is separate from request-facing AutomationService because Eventing owns
 * redelivery, delay, and deduplication of these operations.
 */
export abstract class AutomationEvaluationSubscriberService {
  abstract handleEvaluationTriggerMatch(
    event: AutomationEvaluationSubscriberEvent,
    context: AutomationEvaluationSubscriberContext,
  ): Promise<void>;

  abstract handleEvaluationGraphTriggerActivity(
    event: AutomationEvaluationSubscriberEvent,
    context: AutomationEvaluationActivityContext,
  ): Promise<void>;
}
