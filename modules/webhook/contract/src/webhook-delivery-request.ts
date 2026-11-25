import type { Named } from "@langwatch/module";
import { z } from "zod";

/** ADR-167 Decision 1: one message to one registered endpoint, named by the producer's key. */

const webhookDeliveryMessageSchemaDefinition = z.object({
  type: z.string().min(1),
  idempotencyKey: z.string().min(1).max(256),
  body: z.record(z.string(), z.unknown()),
});
export interface WebhookDeliveryMessageSchema extends Named<
  typeof webhookDeliveryMessageSchemaDefinition
> {}
export const webhookDeliveryMessageSchema: WebhookDeliveryMessageSchema =
  webhookDeliveryMessageSchemaDefinition;
export type WebhookDeliveryMessage = z.infer<typeof webhookDeliveryMessageSchema>;

/** Who asked: the producing module and its own reference (a rule, a trigger, an alert). */
const webhookDeliverySourceSchemaDefinition = z.object({
  module: z.string().min(1),
  ref: z.string().min(1),
});
export interface WebhookDeliverySourceSchema extends Named<
  typeof webhookDeliverySourceSchemaDefinition
> {}
export const webhookDeliverySourceSchema: WebhookDeliverySourceSchema =
  webhookDeliverySourceSchemaDefinition;
export type WebhookDeliverySource = z.infer<typeof webhookDeliverySourceSchema>;

const webhookDeliveryRequestSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  destinationId: z.string().min(1),
  message: webhookDeliveryMessageSchema,
  source: webhookDeliverySourceSchema,
});
export interface WebhookDeliveryRequestSchema extends Named<
  typeof webhookDeliveryRequestSchemaDefinition
> {}
export const webhookDeliveryRequestSchema: WebhookDeliveryRequestSchema =
  webhookDeliveryRequestSchemaDefinition;
export type WebhookDeliveryRequest = z.infer<typeof webhookDeliveryRequestSchema>;

/** The envelope id the receiver sees; one key always answers the same id. */
const webhookDeliveryRequestResultSchemaDefinition = z.object({
  deliveryId: z.string().min(1),
});
export interface WebhookDeliveryRequestResultSchema extends Named<
  typeof webhookDeliveryRequestResultSchemaDefinition
> {}
export const webhookDeliveryRequestResultSchema: WebhookDeliveryRequestResultSchema =
  webhookDeliveryRequestResultSchemaDefinition;
export type WebhookDeliveryRequestResult = z.infer<typeof webhookDeliveryRequestResultSchema>;
