import type { Named } from "@langwatch/module";
import { z } from "zod";

export const WEBHOOK_DELIVERY_OUTCOMES = ["success", "retryable", "terminal", "pending"] as const;
export type WebhookDeliveryOutcome = (typeof WEBHOOK_DELIVERY_OUTCOMES)[number];

export const webhookDeliveryOutcomeSchema = z.enum(WEBHOOK_DELIVERY_OUTCOMES);

const webhookFailureResponseSchemaDefinition = z.object({
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  retryAfterMs: z.number().optional(),
});
export interface WebhookFailureResponseSchema extends Named<
  typeof webhookFailureResponseSchemaDefinition
> {}
export const webhookFailureResponseSchema: WebhookFailureResponseSchema =
  webhookFailureResponseSchemaDefinition;
export type WebhookFailureResponse = z.infer<typeof webhookFailureResponseSchema>;

const webhookDeliveryRowSchemaDefinition = z.object({
  id: z.string(),
  triggerId: z.string(),
  dispatchId: z.string(),
  responseStatus: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  response: webhookFailureResponseSchema.nullable(),
  outcome: webhookDeliveryOutcomeSchema,
  firedAt: z.date(),
});
export interface WebhookDeliveryRowSchema extends Named<
  typeof webhookDeliveryRowSchemaDefinition
> {}
export const webhookDeliveryRowSchema: WebhookDeliveryRowSchema =
  webhookDeliveryRowSchemaDefinition;
export type WebhookDeliveryRow = z.infer<typeof webhookDeliveryRowSchema>;

export type WebhookDeliveryInput = {
  projectId: string;
  triggerId: string;
  dispatchId: string;
  responseStatus?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  response?: WebhookFailureResponse | null;
  outcome: WebhookDeliveryOutcome;
};
