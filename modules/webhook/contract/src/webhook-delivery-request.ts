import { z } from "zod";

/** ADR-167 Decision 1: one message to one registered endpoint, named by the producer's key. */

export const webhookDeliveryMessageSchema = z.object({
  type: z.string().min(1),
  idempotencyKey: z.string().min(1).max(256),
  body: z.record(z.string(), z.unknown()),
});
export type WebhookDeliveryMessage = z.infer<typeof webhookDeliveryMessageSchema>;

/** Who asked: the producing module and its own reference (a rule, a trigger, an alert). */
export const webhookDeliverySourceSchema = z.object({
  module: z.string().min(1),
  ref: z.string().min(1),
});
export type WebhookDeliverySource = z.infer<typeof webhookDeliverySourceSchema>;

export const webhookDeliveryRequestSchema = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  destinationId: z.string().min(1),
  message: webhookDeliveryMessageSchema,
  source: webhookDeliverySourceSchema,
});
export type WebhookDeliveryRequest = z.infer<typeof webhookDeliveryRequestSchema>;

/** The envelope id the receiver sees; one key always answers the same id. */
export const webhookDeliveryRequestResultSchema = z.object({
  deliveryId: z.string().min(1),
});
export type WebhookDeliveryRequestResult = z.infer<typeof webhookDeliveryRequestResultSchema>;
